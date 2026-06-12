import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ALLE_ROLLEN } from '../common/decorators/roles.decorator';

const ROLLEN = ALLE_ROLLEN as string[];
const STATUS = ['EINGELADEN', 'VERIFIZIERT', 'DEAKTIVIERT'];

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(ROLLEN)
  rolle!: string;

  // Für AGM: zuzuordnende Region(en) (Kostenstellen-Scope). Wird als RegionsVerantwortung angelegt.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  regionCodes?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(ROLLEN)
  rolle?: string;

  @IsOptional()
  @IsIn(STATUS)
  status?: string;
}
