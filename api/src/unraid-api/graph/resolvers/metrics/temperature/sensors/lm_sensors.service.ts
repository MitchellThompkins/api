import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Import ConfigService

import { execa } from 'execa';

import {
    RawTemperatureSensor,
    TemperatureSensorProvider,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/sensor.interface.js';
import {
    SensorType,
    TemperatureUnit,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';

@Injectable()
export class LmSensorsService implements TemperatureSensorProvider {
    readonly id = 'lm-sensors';
    private readonly logger = new Logger(LmSensorsService.name);
    private readonly timeoutMs = 3000;

    constructor(private readonly configService: ConfigService) {}

    async isAvailable(): Promise<boolean> {
        try {
            await execa('sensors', ['--version'], { timeout: this.timeoutMs });
            return true;
        } catch {
            return false;
        }
    }

    async read(): Promise<RawTemperatureSensor[]> {
        const configPath = this.configService.get<string>(
            'api.temperature.sensors.lm_sensors.config_path'
        );

        const args = ['-j'];
        if (configPath) {
            args.push('-c', configPath);
        }

        const { stdout } = await execa('sensors', args, { timeout: this.timeoutMs });
        const data: unknown = JSON.parse(stdout);

        if (!this.isRecord(data)) return [];

        const sensors: RawTemperatureSensor[] = [];

        for (const [chipName, chip] of Object.entries(data)) {
            if (!this.isRecord(chip)) continue;

            for (const [label, values] of Object.entries(chip)) {
                if (label === 'Adapter' || !this.isRecord(values)) continue;

                for (const [key, value] of Object.entries(values)) {
                    if (!key.endsWith('_input') || typeof value !== 'number') continue;

                    const name = `${chipName} ${label}`;

                    sensors.push({
                        id: `${chipName}:${label}:${key}`,
                        name,
                        type: this.inferType(name),
                        value,
                        unit: TemperatureUnit.CELSIUS,
                    });
                }
            }
        }

        return sensors;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    private inferType(name: string): SensorType {
        const n = name.toLowerCase();
        if (n.includes('package')) return SensorType.CPU_PACKAGE;
        if (n.includes('core')) return SensorType.CPU_CORE;
        if (n.includes('nvme')) return SensorType.NVME;
        if (n.includes('gpu')) return SensorType.GPU;
        if (n.includes('wmi')) return SensorType.MOTHERBOARD;
        return SensorType.CUSTOM;
    }
}
