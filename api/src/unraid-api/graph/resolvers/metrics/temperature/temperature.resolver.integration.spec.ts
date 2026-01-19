import { INestApplication } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { Test, TestingModule } from '@nestjs/testing';

import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetricsResolver } from '@app/unraid-api/graph/resolvers/metrics/metrics.resolver.js';
import {
    SensorType,
    TemperatureStatus,
    TemperatureUnit,
} from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';
import { TemperatureService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.service.js';

// ... other imports as needed

describe('Temperature GraphQL Integration', () => {
    let app: INestApplication;
    let temperatureService: TemperatureService;

    const mockTemperatureMetrics = {
        id: 'temperature-metrics',
        sensors: [
            {
                id: 'cpu:package',
                name: 'CPU Package',
                type: SensorType.CPU_PACKAGE,
                current: {
                    value: 55,
                    unit: TemperatureUnit.CELSIUS,
                    timestamp: new Date(),
                    status: TemperatureStatus.NORMAL,
                },
            },
        ],
        summary: {
            average: 55,
            hottest: {
                /* ... */
            },
            coolest: {
                /* ... */
            },
            warningCount: 0,
            criticalCount: 0,
        },
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            // Set up your test module with mocked services
            providers: [
                {
                    provide: TemperatureService,
                    useValue: {
                        getMetrics: vi.fn().mockResolvedValue(mockTemperatureMetrics),
                    },
                },
                // ... other required providers
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
        temperatureService = module.get<TemperatureService>(TemperatureService);
    });

    it('should return temperature data via metrics query', async () => {
        const query = `
            query {
                metrics {
                    temperature {
                        sensors {
                            id
                            name
                            type
                            current {
                                value
                                unit
                                status
                            }
                        }
                        summary {
                            average
                            warningCount
                            criticalCount
                        }
                    }
                }
            }
        `;

        const response = await request(app.getHttpServer()).post('/graphql').send({ query }).expect(200);

        expect(response.body.data.metrics.temperature).toBeDefined();
        expect(response.body.data.metrics.temperature.sensors).toHaveLength(1);
        expect(response.body.data.metrics.temperature.sensors[0].name).toBe('CPU Package');
    });

    it('should handle null temperature metrics gracefully', async () => {
        vi.mocked(temperatureService.getMetrics).mockResolvedValue(null);

        const query = `
            query {
                metrics {
                    temperature {
                        sensors { id }
                    }
                }
            }
        `;

        const response = await request(app.getHttpServer()).post('/graphql').send({ query }).expect(200);

        expect(response.body.data.metrics.temperature).toBeNull();
    });
});
