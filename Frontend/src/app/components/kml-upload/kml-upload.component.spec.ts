import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KmlUploadComponent } from './kml-upload.component';

describe('KmlUploadComponent', () => {
  let component: KmlUploadComponent;
  let fixture: ComponentFixture<KmlUploadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KmlUploadComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KmlUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
