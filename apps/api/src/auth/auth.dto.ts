import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  passwort!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsString()
  @MaxLength(200)
  passwort!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsString()
  @MaxLength(200)
  passwort!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(200)
  altesPasswort!: string;

  @IsString()
  @MaxLength(200)
  neuesPasswort!: string;
}
