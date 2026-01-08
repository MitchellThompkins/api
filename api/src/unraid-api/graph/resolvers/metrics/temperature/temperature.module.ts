// temperature/temperature.module.ts
import { Module } from '@nestjs/common';

import { DisksModule } from '@app/unraid-api/graph/resolvers/disks/disks.module.js';
import { DiskSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/disk_sensors.service.js';
import { LmSensorsService } from '@app/unraid-api/graph/resolvers/metrics/temperature/sensors/lm_sensors.service.js';
import { TemperatureHistoryService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature_history.service.js';
import { TemperatureService } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.service.js';

@Module({
    imports: [DisksModule],
    providers: [
        TemperatureService,
        LmSensorsService,
        DiskSensorsService,
        // (@mitchellthompkins) Add other services here
        // GpuSensorsService,
        TemperatureHistoryService,
    ],
    exports: [TemperatureService],
})
export class TemperatureModule {}
