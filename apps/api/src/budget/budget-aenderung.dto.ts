import { IsInt, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBudgetAenderungDto {
  @IsOptional()
  @IsString()
  budgetId?: string;

  @IsInt()
  jahr!: number;

  @IsString()
  regionCode!: string;

  @IsOptional()
  @IsString()
  landId?: string;

  @IsString()
  e1Id!: string;

  @IsNumber()
  neuWertEur!: number;

  @IsOptional()
  @IsNumber()
  neuUnits?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  begruendung!: string;
}

export class EntscheidungDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  begruendung?: string;
}
