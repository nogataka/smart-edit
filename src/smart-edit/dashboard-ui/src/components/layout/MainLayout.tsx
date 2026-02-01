import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="main-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar />
        <main className="content-area">
          {children}
        </main>
      </div>
    </div>
  );
}
