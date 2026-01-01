import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

import { execa } from 'execa';

import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm-sensors.service.js';
import {
    SensorType,
    TemperatureMetrics,
    TemperatureReading,
    TemperatureSensor,
    TemperatureStatus,
    TemperatureUnit,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';

@Injectable()
export class TemperatureService implements OnModuleInit {
    private readonly logger = new Logger(TemperatureService.name);
    //private readonly binPath: string;
    private availableTools: Map<string, string> = new Map();

    private cache: TemperatureMetrics | null = null;
    private cacheTimestamp = 0;
    private readonly CACHE_TTL_MS = 1000;

    constructor(
        private readonly lmSensors: LmSensorsService,
        private readonly configService: ConfigService
    ) {}

    async onModuleInit() {
        await this.initializeBundledTools();
    }

    private async initializeBundledTools(): Promise<void> {
        const systemSensors = '/usr/bin/sensors';

        try {
            await execa(systemSensors, ['--version']);
            this.availableTools.set('sensors', systemSensors);
            this.logger.log(`Temperature tool available: sensors (from system path)`);
        } catch (err) {
            this.logger.warn(`Temperature tool not available at ${systemSensors}`, err);
        }
    }

    private async execTool(toolName: string, args: string[]): Promise<string> {
        const toolPath = this.availableTools.get(toolName);
        if (!toolPath) {
            throw new Error(`Tool ${toolName} not available`);
        }
        const { stdout } = await execa(toolPath, args);
        return stdout;
    }

    // ============================
    // Public API
    // ============================
    async getMetrics(): Promise<TemperatureMetrics | null> {
        const now = Date.now();
        if (this.cache && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
            return this.cache;
        }

        if (!this.availableTools.has('sensors')) {
            this.logger.debug('Temperature metrics unavailable (sensors missing)');
            return null;
        }
        //const output = await this.execTool('sensors', ['-j']);

        //const sensors = this.parseSensorsJson(output);

        //if (sensors.length === 0) {
        //    this.logger.debug('No temperature sensors detected');
        //    return null;
        //}

        const rawSensors = await this.lmSensors.read();
        const sensors: TemperatureSensor[] = rawSensors.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            current: {
                value: r.value,
                unit: r.unit,
                timestamp: new Date(),
                status: this.computeStatus(r.value),
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
    }

    // ============================
    // Parsing
    // ============================
    private parseSensorsJson(output: string): TemperatureSensor[] {
        let data: Record<string, any>;

        try {
            data = JSON.parse(output);
        } catch (err) {
            this.logger.error('Failed to parse sensors JSON', err);
            return [];
        }

        const sensors: TemperatureSensor[] = [];

        for (const [chipName, chip] of Object.entries(data)) {
            for (const [label, values] of Object.entries<any>(chip)) {
                if (label === 'Adapter') continue;
                if (typeof values !== 'object') continue;

                for (const [key, value] of Object.entries<any>(values)) {
                    if (!key.endsWith('_input')) continue;
                    if (typeof value !== 'number') continue;

                    const name = `${chipName} ${label}`;

                    sensors.push({
                        id: `sensor:${chipName}:${label}:${key}`,
                        name,
                        type: this.inferSensorType(name),
                        current: {
                            value,
                            unit: TemperatureUnit.CELSIUS,
                            timestamp: new Date(),
                            status: this.computeStatus(value),
                        },
                    });
                }
            }
        }

        return sensors;
    }

    private inferSensorType(name: string): SensorType {
        const n = name.toLowerCase();

        if (n.includes('package')) return SensorType.CPU_PACKAGE;
        if (n.includes('core')) return SensorType.CPU_CORE;
        if (n.includes('gpu')) return SensorType.GPU;
        if (n.includes('nvme')) return SensorType.NVME;
        if (n.includes('board')) return SensorType.MOTHERBOARD;
        if (n.includes('wmi')) return SensorType.MOTHERBOARD; // TODO Validate this

        return SensorType.CUSTOM;
    }

    private computeStatus(value: number): TemperatureStatus {
        if (value >= 90) return TemperatureStatus.CRITICAL;
        if (value >= 80) return TemperatureStatus.WARNING;
        return TemperatureStatus.NORMAL;
    }

    // ============================
    // Summary
    // ============================

    private buildSummary(sensors: TemperatureSensor[]) {
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
