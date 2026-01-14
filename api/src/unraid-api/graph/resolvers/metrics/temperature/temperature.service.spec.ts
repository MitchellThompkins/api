import { ConfigService } from '@nestjs/config';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiskSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/disk_sensors.service.js';
import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm_sensors.service.js';
import { TemperatureHistoryService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature_history.service.js';
import {
    SensorType,
    TemperatureStatus,
    TemperatureUnit,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';
import { TemperatureService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.service.js';

describe('TemperatureService', () => {
    let service: TemperatureService;
    let lmSensors: LmSensorsService;
    let diskSensors: DiskSensorsService;
    let history: TemperatureHistoryService;
    let configService: ConfigService;

    beforeEach(async () => {
        lmSensors = {
            id: 'lm-sensors',
            isAvailable: vi.fn().mockResolvedValue(true),
            read: vi.fn().mockResolvedValue([
                {
                    id: 'cpu:package',
                    name: 'CPU Package',
                    type: SensorType.CPU_PACKAGE,
                    value: 55,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]),
        } as any;

        diskSensors = {
            id: 'disk-sensors',
            isAvailable: vi.fn().mockResolvedValue(true),
            read: vi.fn().mockResolvedValue([]),
        } as any;

        configService = {
            get: vi.fn((key: string, defaultValue?: any) => defaultValue),
        } as any;

        history = new TemperatureHistoryService(configService);

        service = new TemperatureService(lmSensors, diskSensors, history, configService);
    });

    describe('initialization', () => {
        it('should initialize available providers', async () => {
            await service.onModuleInit();

            expect(lmSensors.isAvailable).toHaveBeenCalled();
            expect(diskSensors.isAvailable).toHaveBeenCalled();
        });

        it('should handle provider initialization errors gracefully', async () => {
            vi.mocked(lmSensors.isAvailable).mockRejectedValue(new Error('Failed'));

            await service.onModuleInit();

            // Should not throw
            const metrics = await service.getMetrics();
            expect(metrics).toBeDefined();
        });
    });

    describe('getMetrics', () => {
        beforeEach(async () => {
            await service.onModuleInit();
        });

        it('should return temperature metrics', async () => {
            const metrics = await service.getMetrics();

            expect(metrics).toBeDefined();
            expect(metrics?.sensors).toHaveLength(1);
            expect(metrics?.sensors[0].name).toBe('CPU Package');
            expect(metrics?.sensors[0].current.value).toBe(55);
        });

        it('should return null when no providers available', async () => {
            vi.mocked(lmSensors.isAvailable).mockResolvedValue(false);
            vi.mocked(diskSensors.isAvailable).mockResolvedValue(false);

            const emptyService = new TemperatureService(lmSensors, diskSensors, history, configService);
            await emptyService.onModuleInit();

            const metrics = await emptyService.getMetrics();
            expect(metrics).toBeNull();
        });

        it('should compute correct status based on thresholds', async () => {
            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'cpu:hot',
                    name: 'Hot CPU',
                    type: SensorType.CPU_CORE,
                    value: 75,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();
            expect(metrics?.sensors[0].current.status).toBe(TemperatureStatus.WARNING);
        });

        it('should use config thresholds when provided', async () => {
            const customConfigService = {
                get: vi.fn((key: string, defaultValue?: any) => {
                    if (key === 'temperature.thresholds') {
                        return { cpu_warning: 60, cpu_critical: 80 };
                    }
                    return defaultValue;
                }),
            } as any;

            const customService = new TemperatureService(
                lmSensors,
                diskSensors,
                history,
                customConfigService
            );
            await customService.onModuleInit();

            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'cpu:warm',
                    name: 'Warm CPU',
                    type: SensorType.CPU_CORE,
                    value: 65,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await customService.getMetrics();
            expect(metrics?.sensors[0].current.status).toBe(TemperatureStatus.WARNING);
        });
    });

    describe('buildSummary', () => {
        it('should calculate correct average', async () => {
            await service.onModuleInit();
            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'sensor1',
                    name: 'Sensor 1',
                    type: SensorType.CPU_CORE,
                    value: 40,
                    unit: TemperatureUnit.CELSIUS,
                },
                {
                    id: 'sensor2',
                    name: 'Sensor 2',
                    type: SensorType.CPU_CORE,
                    value: 60,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();
            expect(metrics?.summary.average).toBe(50);
        });

        it('should identify hottest and coolest sensors', async () => {
            await service.onModuleInit();
            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 's1',
                    name: 'Cool',
                    type: SensorType.CPU_CORE,
                    value: 30,
                    unit: TemperatureUnit.CELSIUS,
                },
                {
                    id: 's2',
                    name: 'Hot',
                    type: SensorType.CPU_CORE,
                    value: 80,
                    unit: TemperatureUnit.CELSIUS,
                },
                {
                    id: 's3',
                    name: 'Medium',
                    type: SensorType.CPU_CORE,
                    value: 50,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();
            expect(metrics?.summary.hottest.name).toBe('Hot');
            expect(metrics?.summary.coolest.name).toBe('Cool');
        });
    });
});
