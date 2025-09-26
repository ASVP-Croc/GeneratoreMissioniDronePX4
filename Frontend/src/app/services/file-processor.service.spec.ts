import { TestBed } from '@angular/core/testing';

import { FileProcessorService } from './file-processor.service';

describe('FileProcessorService', () => {
  let service: FileProcessorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FileProcessorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
