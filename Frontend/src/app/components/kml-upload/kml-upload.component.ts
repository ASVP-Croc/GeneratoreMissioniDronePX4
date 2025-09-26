import { Component } from '@angular/core';
import { FileProcessorService } from '../../services/file-processor.service';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-kml-upload',
  standalone: true,
  imports: [FormsModule, NgIf],
  templateUrl: './kml-upload.component.html',
  styleUrl: './kml-upload.component.scss'
})
export class KmlUploadComponent {
  selectedFile: File | null = null;
  outputType: string = 'python';
  isLoading: boolean = false;
  errorMessage: string = '';

  constructor(private fileProcessor: FileProcessorService) {}

  onFileSelected(event: any): void {
    console.log('File selezionato:', event.target.files[0]);
    this.selectedFile = event.target.files[0];
    this.errorMessage = '';
  }

  async onProcessFile(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'Seleziona un file KML prima di procedere';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    console.log('Inizio elaborazione file...');

    try {
      await this.fileProcessor.processKML(this.selectedFile, this.outputType);
      console.log('File processato con successo');
    } catch (error: any) {
      console.error('Errore nel componente:', error);
      this.errorMessage = error.message || 'Si è verificato un errore durante l\'elaborazione del file';
      console.log('Messaggio di errore impostato:', this.errorMessage);
    } finally {
      this.isLoading = false;
      console.log('Elaborazione completata, isLoading:', this.isLoading);
    }
  }
}