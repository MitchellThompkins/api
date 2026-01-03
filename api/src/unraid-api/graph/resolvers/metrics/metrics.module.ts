import { Module } from '@nestjs/common';

import { CpuModule } from '@app/unraid-api/graph/resolvers/info/cpu/cpu.module.js';
import { MemoryService } from '@app/unraid-api/graph/resolvers/info/memory/memory.service.js';
import { MetricsResolver } from '@app/unraid-api/graph/resolvers/metrics/metrics.resolver.js';
import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm-sensors.service.js';
import { TemperatureService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.service.js';
import { ServicesModule } from '@app/unraid-api/graph/services/services.module.js';

@Module({
    imports: [ServicesModule, CpuModule],
    providers: [MetricsResolver, MemoryService, TemperatureService, LmSensorsService],
    exports: [MetricsResolver],
})
export class MetricsModule {}
