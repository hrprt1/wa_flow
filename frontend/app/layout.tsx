import type { Metadata } from 'next';
import './globals.css';
import FormFeedback from '@/components/form-feedback';
export const metadata: Metadata = { title: { default: 'WaFlow', template: '%s · WaFlow' }, description: 'Your WhatsApp business workspace.' };
const themeScript = `(function(){try{var t=localStorage.getItem('waflow-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme='light'}})()`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
 return <html lang="en" suppressHydrationWarning><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&amp;family=Manrope:wght@400;500;600;650;700;750;800&amp;display=swap" rel="stylesheet" /><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}<FormFeedback /></body></html>;
}

