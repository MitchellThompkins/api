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

    constructor(private readonly configService: ConfigService) {}

    async isAvailable(): Promise<boolean> {
        try {
            await execa('sensors', ['--version']);
            return true;
        } catch {
            return false;
        }
    }

    async read(): Promise<RawTemperatureSensor[]> {
        // Read the config path from your new configuration structure
        const configPath = this.configService.get<string>(
            'api.temperature.sensors.lm_sensors.config_path'
        );

        // Build arguments: add '-c path' if configPath exists
        const args = ['-j'];
        if (configPath) {
            args.push('-c', configPath);
        }

        const { stdout } = await execa('sensors', args);
        const data = JSON.parse(stdout);

        const sensors: RawTemperatureSensor[] = [];

        for (const [chipName, chip] of Object.entries<any>(data)) {
            for (const [label, values] of Object.entries<any>(chip)) {
                if (label === 'Adapter') continue;
                if (typeof values !== 'object') continue;

                for (const [key, value] of Object.entries<any>(values)) {
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
