import React from 'react';

export function App() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#1f2937',
      color: 'white',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Openclaw Easy - Debug Mode</h1>
      <p>✅ React is loading successfully!</p>
      <p>✅ Electron renderer process is working!</p>
      <p>✅ Basic styling is applied!</p>
      <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: '#374151', borderRadius: '8px' }}>
        <h2>System Status:</h2>
        <p>Time: {new Date().toISOString()}</p>
        <p>User Agent: {navigator.userAgent}</p>
        <p>Platform: {navigator.platform}</p>
      </div>
    </div>
  );
}