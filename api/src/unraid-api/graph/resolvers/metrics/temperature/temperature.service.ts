import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';

import { execa } from 'execa';

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
    private readonly binPath: string;
    private availableTools: Map<string, string> = new Map();

    constructor(private readonly configService: ConfigService) {
        // TODO(@mitchellthompkins): Make this something sensible
        this.binPath = this.configService.get(
            'API_MONITORING_BIN_PATH',
            '/usr/local/emhttp/plugins/unraid-api/monitoring'
        );
    }

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
        if (!this.availableTools.has('sensors')) {
            this.logger.debug('Temperature metrics unavailable (sensors missing)');
            return null;
        }

        const output = await this.execTool('sensors', []);
        const sensors = this.parseSensorsOutput(output);

        if (sensors.length === 0) {
            return null;
        }

        return {
            id: 'temperature-metrics',
            sensors,
            summary: this.buildSummary(sensors),
        };
    }

    // ============================
    // Parsing
    // ============================
    private parseSensorsOutput(output: string): TemperatureSensor[] {
        const lines = output.split('\n');
        const sensors: TemperatureSensor[] = [];

        for (const line of lines) {
            const match = line.match(/^(.+?):.*?\+([0-9.]+)\s*°?C/);
            if (!match) continue;

            const name = match[1].trim();
            const value = Number(match[2]);

            const temperatureReading: TemperatureReading = {
                value,
                unit: TemperatureUnit.CELSIUS,
                timestamp: new Date(),
                status: this.computeStatus(value),
            };

            sensors.push({
                id: `sensor:${name}`,
                name,
                type: this.inferSensorType(name),
                current: temperatureReading,
            });
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
