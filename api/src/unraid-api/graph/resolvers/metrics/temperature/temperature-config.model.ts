import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

import { TemperatureUnit } from '@app/unraid-api/graph/resolvers/metrics/temperature/temperature.model.js';

export class SensorConfig {
    @IsBoolean()
    @IsOptional()
    enabled?: boolean;
}

export class LmSensorsConfig extends SensorConfig {
    @IsString()
    @IsOptional()
    config_path?: string;
}

export class IpmiConfig extends SensorConfig {
    @IsString({ each: true })
    @IsOptional()
    args?: string[];
}

export class TemperatureSensorsConfig {
    @ValidateNested()
    @Type(() => LmSensorsConfig)
    @IsOptional()
    lm_sensors?: LmSensorsConfig;

    @ValidateNested()
    @Type(() => SensorConfig)
    @IsOptional()
    smartctl?: SensorConfig;

    @ValidateNested()
    @Type(() => IpmiConfig)
    @IsOptional()
    ipmi?: IpmiConfig;
}

export class TemperatureThresholdsConfig {
    @IsNumber()
    @IsOptional()
    cpu_warning?: number;

    @IsNumber()
    @IsOptional()
    cpu_critical?: number;

    @IsNumber()
    @IsOptional()
    disk_warning?: number;

    @IsNumber()
    @IsOptional()
    disk_critical?: number;

    @IsNumber()
    @IsOptional()
    warning?: number;

    @IsNumber()
    @IsOptional()
    critical?: number;
}

export class TemperatureConfig {
    @IsEnum(TemperatureUnit)
    @IsOptional()
    default_unit?: TemperatureUnit;

    @ValidateNested()
    @Type(() => TemperatureSensorsConfig)
    @IsOptional()
    sensors?: TemperatureSensorsConfig;

    @ValidateNested()
    @Type(() => TemperatureThresholdsConfig)
    @IsOptional()
    thresholds?: TemperatureThresholdsConfig;
}
