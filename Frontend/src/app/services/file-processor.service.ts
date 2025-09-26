import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class FileProcessorService {
  private apiUrl = 'http://localhost:3000/api/process-kml';

  constructor(private http: HttpClient) { }

  async processKML(file: File, outputType: string): Promise<void> {
    const formData = new FormData();
    formData.append('kmlFile', file);
    formData.append('outputType', outputType);

    try {
      const response = await lastValueFrom(
        this.http.post(this.apiUrl, formData, {
          responseType: 'blob',
          observe: 'response'
        })
      );

      if (response.body) {
        this.downloadFile(response.body, outputType);
      }

    } catch (error: any) {
      console.error('Errore HTTP completo:', error);
      const specificError = await this.extractBackendErrorMessage(error);
      throw new Error(specificError);
    }
  }

  // Gestione Errori
  private async extractBackendErrorMessage(error: any): Promise<string> {
    if (typeof error === 'string') {
      return error;
    }
    if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
      try {
        const errorText = await this.blobToText(error.error);
        console.log('Testo errore dal backend:', errorText);
        
        const errorJson = JSON.parse(errorText);
        return errorJson.error || 'Errore nel processing del file';
      } catch (parseError) {
        console.error('Errore nel parsing della risposta di errore:', parseError);
        return 'Errore nel processing del file';
      }
    }
    if (error instanceof HttpErrorResponse && error.error && typeof error.error === 'object') {
      return error.error.error || error.message || 'Errore nel processing del file';
    }
    if (error.error) {
      return error.error;
    }

    if (error.message) {
      return error.message;
    }
    return 'Errore nel processing del file';
  }

  private blobToText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Impossibile leggere il blob'));
      reader.readAsText(blob);
    });
  }

  private downloadFile(blob: Blob, outputType: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    if (outputType === 'python') {
      a.download = 'mission_script.py';
    } else {
      a.download = 'mission.plan';
    }

    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}