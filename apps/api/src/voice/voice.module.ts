import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { SttService, LlmExtraktionService } from './voice.providers';

@Module({
  controllers: [VoiceController],
  providers: [VoiceService, SttService, LlmExtraktionService],
  exports: [VoiceService],
})
export class VoiceModule {}
