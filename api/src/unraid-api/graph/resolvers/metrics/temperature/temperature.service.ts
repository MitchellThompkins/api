import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DiskSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/disk_sensors.service.js';
import { IpmiSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/ipmi_sensors.service.js';
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
        private readonly ipmiSensors: IpmiSensorsService,

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
        // 1. Get sensor specific configs
        const lmSensorsConfig = this.configService.get('api.temperature.sensors.lm_sensors');
        const smartctlConfig = this.configService.get('api.temperature.sensors.smartctl');
        const ipmiConfig = this.configService.get('api.temperature.sensors.ipmi');

        // 2. Define providers with their config checks
        // We default to TRUE if the config is missing
        const potentialProviders = [
            {
                service: this.lmSensors,
                enabled: lmSensorsConfig?.enabled ?? true,
            },
            {
                service: this.diskSensors,
                enabled: smartctlConfig?.enabled ?? true,
            },
            {
                service: this.ipmiSensors,
                enabled: ipmiConfig?.enabled ?? true,
            },
            // TODO(@mitchellthompkins): this.gpuSensors,
        ];

        for (const provider of potentialProviders) {
            // Skip if explicitly disabled in config
            if (!provider.enabled) {
                this.logger.debug(`Skipping ${provider.service.id} (disabled in config)`);
                continue;
            }

            try {
                if (await provider.service.isAvailable()) {
                    this.availableProviders.push(provider.service);
                    this.logger.log(`Temperature provider available: ${provider.service.id}`);
                } else {
                    this.logger.debug(`Temperature provider not available: ${provider.service.id}`);
                }
            } catch (err) {
                this.logger.warn(`Failed to check provider ${provider.service.id}`, err);
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

            const configUnit =
                this.configService.get<string>('api.temperature.default_unit') || 'celsius';
            const targetUnit =
                (TemperatureUnit as any)[configUnit.toUpperCase()] || TemperatureUnit.CELSIUS;

            const sensors: TemperatureSensor[] = allRawSensors.map((r) => {
                const rawCurrent: TemperatureReading = {
                    value: r.value,
                    unit: r.unit,
                    timestamp: new Date(),
                    status: this.computeStatus(r.value, r.type),
                };

                // Record in history (ALWAYS RAW)
                this.history.record(r.id, rawCurrent, {
                    name: r.name,
                    type: r.type,
                });

                // Get historical data (RAW)
                const { min, max } = this.history.getMinMax(r.id);
                const rawHistory = this.history.getHistory(r.id);

                // Convert for output
                const current = this.convertReading(rawCurrent, targetUnit) as TemperatureReading;
                const history = rawHistory
                    .map((h) => this.convertReading(h, targetUnit))
                    .filter((h): h is TemperatureReading => h !== undefined);
                const minConverted = this.convertReading(min, targetUnit);
                const maxConverted = this.convertReading(max, targetUnit);

                return {
                    id: r.id,
                    name: r.name,
                    type: r.type,
                    current,
                    min: minConverted,
                    max: maxConverted,
                    history,
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

        const configUnit = this.configService.get<string>('api.temperature.default_unit') || 'celsius';
        const targetUnit = (TemperatureUnit as any)[configUnit.toUpperCase()] || TemperatureUnit.CELSIUS;

        const sensors = allSensorIds
            .map((sensorId): TemperatureSensor | null => {
                const { min, max } = this.history.getMinMax(sensorId);
                const rawHistory = this.history.getHistory(sensorId);
                const rawCurrent = rawHistory[rawHistory.length - 1];
                const metadata = this.history.getMetadata(sensorId)!;

                if (!rawCurrent) return null;

                // Convert for output
                const current = this.convertReading(rawCurrent, targetUnit) as TemperatureReading;
                const history = rawHistory
                    .map((h) => this.convertReading(h, targetUnit))
                    .filter((h): h is TemperatureReading => h !== undefined);
                const minConverted = this.convertReading(min, targetUnit);
                const maxConverted = this.convertReading(max, targetUnit);

                return {
                    id: sensorId,
                    name: metadata.name,
                    type: metadata.type,
                    current,
                    min: minConverted,
                    max: maxConverted,
                    history,
                    warning: this.getThresholdsForType(metadata.type).warning,
                    critical: this.getThresholdsForType(metadata.type).critical,
                };
            })
            .filter((s): s is TemperatureSensor => s !== null);

        return {
            id: 'temperature-metrics',
            sensors,
            summary: this.buildSummary(sensors),
        };
    }

    private convertReading(
        reading: TemperatureReading | undefined,
        targetUnit: TemperatureUnit
    ): TemperatureReading | undefined {
        if (!reading) return undefined;

        let celsius: number;

        // Convert input to Celsius
        switch (reading.unit) {
            case TemperatureUnit.CELSIUS:
                celsius = reading.value;
                break;
            case TemperatureUnit.FAHRENHEIT:
                celsius = ((reading.value - 32) * 5) / 9;
                break;
            case TemperatureUnit.KELVIN:
                celsius = reading.value - 273.15;
                break;
            case TemperatureUnit.RANKINE:
                celsius = ((reading.value - 491.67) * 5) / 9;
                break;
            default:
                celsius = reading.value;
        }

        let targetValue: number;

        // Convert Celsius to target
        switch (targetUnit) {
            case TemperatureUnit.CELSIUS:
                targetValue = celsius;
                break;
            case TemperatureUnit.FAHRENHEIT:
                targetValue = (celsius * 9) / 5 + 32;
                break;
            case TemperatureUnit.KELVIN:
                targetValue = celsius + 273.15;
                break;
            case TemperatureUnit.RANKINE:
                targetValue = ((celsius + 273.15) * 9) / 5;
                break;
            default:
                targetValue = celsius;
        }

        return {
            ...reading,
            value: Number(targetValue.toFixed(2)),
            unit: targetUnit,
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
        const thresholds = this.configService.get('api.temperature.thresholds', {});

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
