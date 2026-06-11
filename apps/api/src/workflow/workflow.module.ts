import { Global, Module } from '@nestjs/common';
import { StateMachineService } from './state-machine.service';

@Global()
@Module({
  providers: [StateMachineService],
  exports: [StateMachineService],
})
export class WorkflowModule {}
