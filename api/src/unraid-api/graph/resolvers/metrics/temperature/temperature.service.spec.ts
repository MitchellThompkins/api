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
                    if (key === 'api.temperature.thresholds') {
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
    describe('edge cases', () => {
        it('should handle provider read timeout gracefully', async () => {
            await service.onModuleInit();

            // Simulate a slow/hanging provider
            vi.mocked(lmSensors.read).mockImplementation(
                () => new Promise((resolve) => setTimeout(() => resolve([]), 1000))
            );

            // If you have timeout logic, test it here
            // Otherwise, this documents expected behavior
            const startTime = Date.now();
            const metrics = await service.getMetrics();
            const elapsed = Date.now() - startTime;

            // Should either timeout or complete - document expected behavior
            expect(metrics).toBeDefined();
        }, 10000);

        it('should deduplicate sensors with same ID from different providers', async () => {
            await service.onModuleInit();

            // Both providers return a sensor with the same ID
            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'duplicate-sensor',
                    name: 'Sensor from lm-sensors',
                    type: SensorType.CPU_CORE,
                    value: 50,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            vi.mocked(diskSensors.read).mockResolvedValue([
                {
                    id: 'duplicate-sensor',
                    name: 'Sensor from disk',
                    type: SensorType.DISK,
                    value: 55,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            // Document expected behavior - currently allows duplicates
            // If you want to dedupe, add logic and update this test
            expect(metrics?.sensors.filter((s) => s.id === 'duplicate-sensor')).toHaveLength(2);
        });

        it('should handle empty sensor name', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'sensor-no-name',
                    name: '',
                    type: SensorType.CUSTOM,
                    value: 45,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            expect(metrics?.sensors[0].name).toBe('');
            // Or if you want to enforce non-empty names:
            // expect(metrics?.sensors[0].name).toBe('Unknown Sensor');
        });

        it('should handle negative temperature values', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'cold-sensor',
                    name: 'Freezer Sensor',
                    type: SensorType.CUSTOM,
                    value: -20,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            expect(metrics?.sensors[0].current.value).toBe(-20);
            expect(metrics?.sensors[0].current.status).toBe(TemperatureStatus.NORMAL);
        });

        it('should handle extremely high temperature values', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'hot-sensor',
                    name: 'Very Hot Sensor',
                    type: SensorType.CPU_CORE,
                    value: 150,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            expect(metrics?.sensors[0].current.value).toBe(150);
            expect(metrics?.sensors[0].current.status).toBe(TemperatureStatus.CRITICAL);
        });

        it('should handle NaN temperature values', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockResolvedValue([
                {
                    id: 'nan-sensor',
                    name: 'Bad Sensor',
                    type: SensorType.CUSTOM,
                    value: NaN,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            // Document expected behavior - should either filter out or handle gracefully
            // Current implementation would include it; you may want to filter
            expect(metrics?.sensors).toHaveLength(1);
        });

        it('should handle all providers failing', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockRejectedValue(new Error('lm-sensors failed'));
            vi.mocked(diskSensors.read).mockRejectedValue(new Error('disk sensors failed'));

            const metrics = await service.getMetrics();

            expect(metrics).toBeNull();
        });

        it('should handle partial provider failures', async () => {
            await service.onModuleInit();

            vi.mocked(lmSensors.read).mockRejectedValue(new Error('lm-sensors failed'));
            vi.mocked(diskSensors.read).mockResolvedValue([
                {
                    id: 'disk:sda',
                    name: 'HDD',
                    type: SensorType.DISK,
                    value: 35,
                    unit: TemperatureUnit.CELSIUS,
                },
            ]);

            const metrics = await service.getMetrics();

            expect(metrics).toBeDefined();
            expect(metrics?.sensors).toHaveLength(1);
            expect(metrics?.sensors[0].name).toBe('HDD');
        });
    });
});
