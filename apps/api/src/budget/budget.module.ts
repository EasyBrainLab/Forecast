import { Module } from '@nestjs/common';
import { BudgetImportService } from './budget-import.service';
import { BudgetAenderungService } from './budget-aenderung.service';
import { BudgetController } from './budget.controller';
import { BudgetAenderungController } from './budget-aenderung.controller';

@Module({
  controllers: [BudgetController, BudgetAenderungController],
  providers: [BudgetImportService, BudgetAenderungService],
  exports: [BudgetImportService, BudgetAenderungService],
})
export class BudgetModule {}
