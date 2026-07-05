import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import Anthropic from '@anthropic-ai/sdk';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { KiConfigService } from './ki-config.service';

class KiEinstellungenDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  llmModell?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sttModell?: string;

  /** Leerstring = Key löschen; nicht gesendet = unverändert. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  anthropicKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  openaiKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  firmenprofil?: string;
}

@ApiTags('ki')
@ApiBearerAuth()
@Controller('ki')
export class KiController {
  constructor(
    private readonly config: KiConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Status ohne Geheimnisse: nur Herkunft (DB/ENV/FEHLT), Modell, Firmenprofil. */
  @Roles('ADMIN', 'SUPPORT')
  @Get('einstellungen')
  status() {
    return this.config.status();
  }

  @Roles('ADMIN')
  @Put('einstellungen')
  async speichern(@Body() dto: KiEinstellungenDto, @CurrentUser() aktor: RequestUser) {
    await this.config.speichere(dto);
    await this.audit.write({
      entitaet: 'KiEinstellungen',
      aktion: 'UPDATE',
      userId: aktor.id,
      userEmail: aktor.email,
      // Nie Key-Werte ins Audit — nur welche Felder berührt wurden.
      metadaten: { felder: Object.keys(dto), anthropicKeyGeaendert: dto.anthropicKey !== undefined, openaiKeyGeaendert: dto.openaiKey !== undefined },
    });
    return this.config.status();
  }

  /** Verbindungstest beider Provider (kostenfrei: count_tokens bzw. Modell-Ping). */
  @Roles('ADMIN')
  @Post('test')
  async test() {
    const [anthropic, openai] = await Promise.all([this.testAnthropic(), this.testOpenai()]);
    return { anthropic, openai };
  }

  private async testAnthropic(): Promise<{ ok: boolean; detail: string }> {
    const key = await this.config.anthropicKey();
    if (!key) return { ok: false, detail: 'Kein API-Key konfiguriert.' };
    const modell = await this.config.llmModell();
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.countTokens({ model: modell, messages: [{ role: 'user', content: 'ping' }] });
      return { ok: true, detail: `Modell ${modell} erreichbar (count_tokens=${res.input_tokens}).` };
    } catch (e) {
      const status = e instanceof Anthropic.APIError ? e.status : undefined;
      return { ok: false, detail: `Anthropic-Fehler${status ? ` ${status}` : ''}: ${(e as Error).message.slice(0, 160)}` };
    }
  }

  private async testOpenai(): Promise<{ ok: boolean; detail: string }> {
    const key = await this.config.openaiKey();
    if (!key) return { ok: false, detail: 'Kein API-Key konfiguriert.' };
    const modell = await this.config.sttModell();
    try {
      const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(modell)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { ok: true, detail: `STT-Modell ${modell} erreichbar.` };
      return { ok: false, detail: `OpenAI-Fehler ${res.status}.` };
    } catch (e) {
      return { ok: false, detail: `Netzwerkfehler: ${(e as Error).message.slice(0, 160)}` };
    }
  }
}
