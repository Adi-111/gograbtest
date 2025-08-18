import { Test, TestingModule } from '@nestjs/testing';
import { CaseInstanceService } from './case-instance.service';

describe('CaseInstanceService', () => {
  let service: CaseInstanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CaseInstanceService],
    }).compile();

    service = module.get<CaseInstanceService>(CaseInstanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
