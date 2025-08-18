import { Test, TestingModule } from '@nestjs/testing';
import { CaseInstanceController } from './case-instance.controller';
import { CaseInstanceService } from './case-instance.service';

describe('CaseInstanceController', () => {
  let controller: CaseInstanceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CaseInstanceController],
      providers: [CaseInstanceService],
    }).compile();

    controller = module.get<CaseInstanceController>(CaseInstanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
