// temperature/temperature.module.ts
import { Module } from '@nestjs/common';

import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm-sensors.service.js';
import { TemperatureService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.service.js';

@Module({
    providers: [
        TemperatureService,
        LmSensorsService,
        // (@mitchellthompkins) Add other services here
        // GpuSensorsService,
    ],
    exports: [TemperatureService],
})
export class TemperatureModule {}
