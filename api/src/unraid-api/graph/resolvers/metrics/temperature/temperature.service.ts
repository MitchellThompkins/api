import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

import { execa } from 'execa';

import { DiskSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/disk_sensors.service.js';
import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm_sensors.service.js';
import {
    RawTemperatureSensor,
    TemperatureSensorProvider,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/sensor.interface.js';
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
        const now = Date.now();
        if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
            return this.cache;
        }

        if (this.availableProviders.length === 0) {
            this.logger.debug('Temperature metrics unavailable (no providers)');
            return null;
        }

        try {
            // Collect sensors from ALL available providers
            const allRawSensors: RawTemperatureSensor[] = [];

            for (const provider of this.availableProviders) {
                try {
                    const sensors = await provider.read();
                    allRawSensors.push(...sensors);
                } catch (err) {
                    this.logger.error(`Failed to read from provider ${provider.id}`, err);
                    // Continue with other providers
                }
            }

            if (allRawSensors.length === 0) {
                this.logger.debug('No temperature sensors detected');
                return null;
            }

            const sensors: TemperatureSensor[] = allRawSensors.map((r) => ({
                id: r.id,
                name: r.name,
                type: r.type,
                current: {
                    value: r.value,
                    unit: r.unit,
                    timestamp: new Date(),
                    status: this.computeStatus(r.value, r.type),
                },
            }));

            const metrics: TemperatureMetrics = {
                id: 'temperature-metrics',
                sensors,
                summary: this.buildSummary(sensors),
            };

            this.cache = metrics;
            this.cacheTimestamp = now;

            return metrics;
        } catch (err) {
            this.logger.error('Failed to read temperature sensors', err);
            return null;
        }
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
        // Future: load from configService
        // For now, use sensible defaults per type
        switch (type) {
            case SensorType.CPU_PACKAGE:
            case SensorType.CPU_CORE:
                return { warning: 70, critical: 85 };
            case SensorType.GPU:
                return { warning: 80, critical: 90 };
            case SensorType.DISK:
            case SensorType.NVME:
                return { warning: 50, critical: 60 };
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
