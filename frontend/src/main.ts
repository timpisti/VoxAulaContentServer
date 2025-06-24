// src/main.ts - Angular standalone application bootstrap
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MessageService, ConfirmationService } from 'primeng/api';
import Aura from '@primeng/themes/aura';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    importProvidersFrom(BrowserAnimationsModule),
	providePrimeNG({
	theme: {
		preset: Aura
	}
	}),
    MessageService,
    ConfirmationService
  ]
}).catch(err => console.error(err));