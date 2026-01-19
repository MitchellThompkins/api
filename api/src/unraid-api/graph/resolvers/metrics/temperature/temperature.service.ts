import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DiskSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/disk_sensors.service.js';
import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm_sensors.service.js';
import {
    RawTemperatureSensor,
    TemperatureSensorProvider,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/sensor.interface.js';
import { TemperatureHistoryService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature_history.service.js';
import {
    SensorType,
    TemperatureMetrics,
    TemperatureReading,
    TemperatureSensor,
    TemperatureStatus,
    TemperatureUnit,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';

// temperature.service.ts
@Injectable()
export class TemperatureService implements OnModuleInit {
    private readonly logger = new Logger(TemperatureService.name);
    private availableProviders: TemperatureSensorProvider[] = [];

    private cache: TemperatureMetrics | null = null;
    private cacheTimestamp = 0;
    private readonly CACHE_TTL_MS = 1000;

    constructor(
        // Inject all available sensor providers
        private readonly lmSensors: LmSensorsService,
        private readonly diskSensors: DiskSensorsService,

        // Future: private readonly gpuSensors: GpuSensorsService,
        // Future: private readonly diskSensors: DiskSensorsService,
        private readonly history: TemperatureHistoryService,
        private readonly configService: ConfigService
    ) {}

    async onModuleInit() {
        // Initialize all providers and check availability
        await this.initializeProviders();
    }

    private async initializeProviders(): Promise<void> {
        const potentialProviders = [
            this.lmSensors,
            this.diskSensors,
            // TODO(@mitchellthompkins): this.gpuSensors,
        ];

        for (const provider of potentialProviders) {
            try {
                if (await provider.isAvailable()) {
                    this.availableProviders.push(provider);
                    this.logger.log(`Temperature provider available: ${provider.id}`);
                } else {
                    this.logger.debug(`Temperature provider not available: ${provider.id}`);
                }
            } catch (err) {
                this.logger.warn(`Failed to check provider ${provider.id}`, err);
            }
        }

        if (this.availableProviders.length === 0) {
            this.logger.warn('No temperature providers available');
        }
    }

    async getMetrics(): Promise<TemperatureMetrics | null> {
        // Check if we can use recent history instead of re-reading sensors
        const mostRecent = this.history.getMostRecentReading();
        const canUseHistory =
            mostRecent && Date.now() - mostRecent.timestamp.getTime() < this.CACHE_TTL_MS;

        if (canUseHistory) {
            // Build from history (fast path)
            return this.buildMetricsFromHistory();
        }

        // Read fresh data from sensors
        if (this.availableProviders.length === 0) {
            this.logger.debug('Temperature metrics unavailable (no providers)');
            return null;
        }

        try {
            const allRawSensors: RawTemperatureSensor[] = [];

            for (const provider of this.availableProviders) {
                try {
                    const sensors = await provider.read();
                    allRawSensors.push(...sensors);
                } catch (err) {
                    this.logger.error(`Failed to read from provider ${provider.id}`, err);
                }
            }

            if (allRawSensors.length === 0) {
                this.logger.debug('No temperature sensors detected');
                return null;
            }

            const sensors: TemperatureSensor[] = allRawSensors.map((r) => {
                const current: TemperatureReading = {
                    value: r.value,
                    unit: r.unit,
                    timestamp: new Date(),
                    status: this.computeStatus(r.value, r.type),
                };

                // Record in history
                this.history.record(r.id, current, {
                    name: r.name,
                    type: r.type,
                });

                // Get historical data
                const { min, max } = this.history.getMinMax(r.id);
                const historicalReadings = this.history.getHistory(r.id);

                return {
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    current,
                    min,
                    max,
                    history: historicalReadings,
                    warning: this.getThresholdsForType(r.type).warning,
                    critical: this.getThresholdsForType(r.type).critical,
                };
            });

            return {
                id: 'temperature-metrics',
                sensors,
                summary: this.buildSummary(sensors),
            };
        } catch (err) {
            this.logger.error('Failed to read temperature sensors', err);
            return null;
        }
    }

    private buildMetricsFromHistory(): TemperatureMetrics | null {
        const allSensorIds = this.history.getAllSensorIds();

        if (allSensorIds.length === 0) {
            return null;
        }

        const sensors: TemperatureSensor[] = allSensorIds.map((sensorId) => {
            const { min, max } = this.history.getMinMax(sensorId);
            const historicalReadings = this.history.getHistory(sensorId);
            const current = historicalReadings[historicalReadings.length - 1];
            const metadata = this.history.getMetadata(sensorId)!;

            return {
                id: sensorId,
                name: metadata.name,
                type: metadata.type,
                current,
                min,
                max,
                history: historicalReadings,
                warning: this.getThresholdsForType(metadata.type).warning,
                critical: this.getThresholdsForType(metadata.type).critical,
            };
        });

        return {
            id: 'temperature-metrics',
            sensors,
            summary: this.buildSummary(sensors),
        };
    }

    // Make status computation type-aware for future per-type thresholds
    private computeStatus(value: number, type: SensorType): TemperatureStatus {
        // Future: load thresholds from config based on type
        const thresholds = this.getThresholdsForType(type);

        if (value >= thresholds.critical) return TemperatureStatus.CRITICAL;
        if (value >= thresholds.warning) return TemperatureStatus.WARNING;
        return TemperatureStatus.NORMAL;
    }

    private getThresholdsForType(type: SensorType): { warning: number; critical: number } {
        const thresholds = this.configService.get('temperature.thresholds', {});

        switch (type) {
            case SensorType.CPU_PACKAGE:
            case SensorType.CPU_CORE:
                return {
                    warning: thresholds.cpu_warning ?? 70,
                    critical: thresholds.cpu_critical ?? 85,
                };
            case SensorType.DISK:
            case SensorType.NVME:
                return {
                    warning: thresholds.disk_warning ?? 50,
                    critical: thresholds.disk_critical ?? 60,
                };
            default:
                return { warning: 80, critical: 90 };
        }
    }

    private buildSummary(sensors: TemperatureSensor[]) {
        if (sensors.length === 0) {
            throw new Error('Cannot build summary with no sensors');
        }

        const values = sensors.map((s) => s.current.value);
        const average = values.reduce((a, b) => a + b, 0) / values.length;
        const hottest = sensors.reduce((a, b) => (a.current.value > b.current.value ? a : b));
        const coolest = sensors.reduce((a, b) => (a.current.value < b.current.value ? a : b));

        return {
            average,
            hottest,
            coolest,
            warningCount: sensors.filter((s) => s.current.status === TemperatureStatus.WARNING).length,
            criticalCount: sensors.filter((s) => s.current.status === TemperatureStatus.CRITICAL).length,
        };
    }
}
