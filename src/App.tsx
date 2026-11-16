import { useEffect, useRef } from 'react';
import { startGame } from './game.js';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Start our plain JavaScript HTML5 Canvas game loop and keep React out of
    // the 60fps render cycle.
    const stopGame = startGame(canvas);
    return () => {
      stopGame();
    };
  }, []);

  return (
    <main className="w-screen h-screen overflow-hidden bg-slate-900">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </main>
  );
}
