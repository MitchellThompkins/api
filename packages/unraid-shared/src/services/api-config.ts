import { Field, ObjectType, Int } from "@nestjs/graphql";
import { IsString, IsArray, IsOptional, IsBoolean, IsNumber, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

@ObjectType()
export class TemperatureHistoryConfig {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  max_readings?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  retention_ms?: number;
}

@ObjectType()
export class TemperatureThresholdsConfig {
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  cpu_warning?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  cpu_critical?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  disk_warning?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  disk_critical?: number;
}

@ObjectType()
export class LmSensorsConfig {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  config_path?: string;
}

@ObjectType()
export class SmartctlConfig {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@ObjectType()
export class IpmiConfig {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@ObjectType()
export class SensorsConfig {
  @Field(() => LmSensorsConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => LmSensorsConfig)
  lm_sensors?: LmSensorsConfig;

  @Field(() => SmartctlConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => SmartctlConfig)
  smartctl?: SmartctlConfig;

  @Field(() => IpmiConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => IpmiConfig)
  ipmi?: IpmiConfig;
}

@ObjectType()
export class TemperatureConfig {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  default_unit?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  polling_interval?: number;

  @Field(() => TemperatureHistoryConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemperatureHistoryConfig)
  history?: TemperatureHistoryConfig;

  @Field(() => TemperatureThresholdsConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemperatureThresholdsConfig)
  thresholds?: TemperatureThresholdsConfig;

  @Field(() => SensorsConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => SensorsConfig)
  sensors?: SensorsConfig;
}

@ObjectType()
export class ApiConfig {
  @Field()
  @IsString()
  version!: string;

  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  extraOrigins!: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;

  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  ssoSubIds!: string[];

  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  plugins!: string[];

  @Field(() => TemperatureConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemperatureConfig)
  temperature?: TemperatureConfig;
}

