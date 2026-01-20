import { Field, ObjectType, Int } from "@nestjs/graphql";
import { IsString, IsArray, IsOptional, IsBoolean, IsNumber, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

// 1. Define the nested classes first

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
export class TemperatureConfig {
  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

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
}

// 2. Add the temperature field to the main ApiConfig class

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

  // --- ADD THIS ---
  @Field(() => TemperatureConfig, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemperatureConfig)
  temperature?: TemperatureConfig;
}
