/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DialogueBox } from './components/DialogueBox';
import { GameHUD } from './components/GameHUD';
import { GameOverScreen } from './components/GameOverScreen';
import { MathNotesModal } from './components/MathNotesModal';
import { NotebookInterface } from './components/NotebookInterface';
import { PauseMenu } from './components/PauseMenu';
import { PlaytimeOverlay } from './components/PlaytimeOverlay';
import { RulesModal } from './components/RulesModal';
import { SettingsMenu } from './components/SettingsMenu';
import { StartMenu } from './components/StartMenu';
import { TouchControls } from './components/TouchControls';
import { VictoryScreen } from './components/VictoryScreen';
import { AudioManager } from './game/AudioManager';
import { FullscreenController, FullscreenStateSnapshot } from './game/fullscreen';
import { createBaldiPhaserGame, PhaserBridge } from './game/GameConfig';
import { AudioSettings, GameSnapshot, GameState, GameStateManager } from './game/GameState';
import { ControlMode, InputPlatformDetector } from './game/inputPlatform';
import { ItemType } from './game/InventoryManager';
import { AnswerChoiceKey } from './game/QuestionDatabase';

export default function App() {
  const mainContainerRef = useRef<HTMLElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<PhaserBridge | null>(null);
  const gameStateRef = useRef<GameStateManager | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const platformDetectorRef = useRef<InputPlatformDetector | null>(null);
  const fullscreenControllerRef = useRef<FullscreenController | null>(null);

  if (!gameStateRef.current) {
    gameStateRef.current = new GameStateManager();
  }
  if (!audioRef.current) {
    audioRef.current = new AudioManager();
  }
  if (!platformDetectorRef.current) {
    platformDetectorRef.current = new InputPlatformDetector();
  }
  if (!fullscreenControllerRef.current) {
    fullscreenControllerRef.current = new FullscreenController(undefined, () =>
      typeof document !== 'undefined' ? document.documentElement : null
    );
  }

  const [snapshot, setSnapshot] = useState<GameSnapshot>(() =>
    gameStateRef.current!.getSnapshot()
  );
  const [controlMode, setControlMode] = useState<ControlMode>(() =>
    platformDetectorRef.current!.getMode()
  );
  const [fullscreenSnap, setFullscreenSnap] = useState<FullscreenStateSnapshot>(() =>
    fullscreenControllerRef.current!.getSnapshot()
  );
  const [isRulesOpen, setIsRulesOpen] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);

  const schedulePhaserScaleSync = useCallback(() => {
    const syncOnce = () => {
      const game = bridgeRef.current?.game;
      const mount = mountRef.current;
      if (!game || !mount) return;
      const rect = mount.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        game.scale.resize(Math.round(rect.width), Math.round(rect.height));
        game.scale.refresh();
      }
    };

    syncOnce();
    const rafId = window.requestAnimationFrame(syncOnce);
    const t1 = window.setTimeout(syncOnce, 120);
    const t2 = window.setTimeout(syncOnce, 320);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Mount Phaser canvas once in isolated ref container so React HUD re-renders never tear down simulation
  useEffect(() => {
    const gs = gameStateRef.current!;
    const audio = audioRef.current!;
    const detector = platformDetectorRef.current!;

    const unsubState = gs.subscribe((nextSnap) => {
      setSnapshot(nextSnap);
    });

    if (mountRef.current && !bridgeRef.current) {
      bridgeRef.current = createBaldiPhaserGame(mountRef.current, gs, audio);
      bridgeRef.current.scene.setControlMode(detector.getMode());
    }

    const unsubPlatform = detector.subscribe((mode) => {
      setControlMode(mode);
      bridgeRef.current?.scene.setControlMode(mode);
    });

    const fsCtrl = fullscreenControllerRef.current!;
    const unsubFullscreen = fsCtrl.subscribe((nextFs) => {
      setFullscreenSnap(nextFs);
      if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.fullscreen = nextFs.isFullscreen ? 'true' : 'false';
        document.body.dataset.fullscreenMode = nextFs.mode;
      }
      schedulePhaserScaleSync();
    });

    const onBrowserFullscreenChange = () => {
      fsCtrl.handleBrowserFullscreenChange();
      schedulePhaserScaleSync();
    };

    const onViewportResize = () => {
      schedulePhaserScaleSync();
    };

    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.code === 'Escape' || e.key === 'Escape') && fsCtrl.getSnapshot().mode === 'viewport') {
        fsCtrl.exitViewportFallbackIfActive();
        schedulePhaserScaleSync();
      }
    };

    document.addEventListener('fullscreenchange', onBrowserFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onBrowserFullscreenChange as EventListener);
    document.addEventListener('mozfullscreenchange', onBrowserFullscreenChange as EventListener);
    document.addEventListener('MSFullscreenChange', onBrowserFullscreenChange as EventListener);
    window.addEventListener('resize', onViewportResize);
    window.addEventListener('orientationchange', onViewportResize);
    window.addEventListener('keydown', onGlobalKeyDown);
    window.visualViewport?.addEventListener('resize', onViewportResize);

    // Support ?autostart=1 query parameter to launch directly into gameplay when requested
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const preNotebooks = Number(params.get('prenotebooks') || '0');
      window.setTimeout(() => {
        gs.startNewGame();
        if (preNotebooks === 6) {
          gs.seedPrecompletedNotebooks([2, 3, 4, 5, 6, 7]);
        }
        bridgeRef.current?.scene.resetSessionForNewGame();
      }, 80);
    }

    return () => {
      unsubState();
      unsubPlatform();
      unsubFullscreen();
      document.removeEventListener('fullscreenchange', onBrowserFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        onBrowserFullscreenChange as EventListener
      );
      document.removeEventListener(
        'mozfullscreenchange',
        onBrowserFullscreenChange as EventListener
      );
      document.removeEventListener(
        'MSFullscreenChange',
        onBrowserFullscreenChange as EventListener
      );
      window.removeEventListener('resize', onViewportResize);
      window.removeEventListener('orientationchange', onViewportResize);
      window.removeEventListener('keydown', onGlobalKeyDown);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      detector.destroy();
      platformDetectorRef.current = null;
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
      audio.destroy();
    };
  }, [schedulePhaserScaleSync]);

  const handleStartNewGame = useCallback(() => {
    const gs = gameStateRef.current!;
    const audio = audioRef.current!;
    setIsRulesOpen(false);
    setIsNotesOpen(false);
    audio.unlock();
    gs.startNewGame();
    bridgeRef.current?.scene.resetSessionForNewGame();
  }, []);

  const handleOpenNotes = useCallback(() => {
    setIsRulesOpen(false);
    audioRef.current?.unlock();
    setIsNotesOpen(true);
  }, []);

  const handleCloseNotes = useCallback(() => {
    setIsNotesOpen(false);
  }, []);

  const handleOpenRules = useCallback(() => {
    setIsNotesOpen(false);
    audioRef.current?.unlock();
    setIsRulesOpen(true);
  }, []);

  const handleCloseRules = useCallback(() => {
    setIsRulesOpen(false);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsRulesOpen(false);
    setIsNotesOpen(false);
    audioRef.current?.unlock();
    gameStateRef.current?.openSettings();
  }, []);

  const handleCloseSettings = useCallback(() => {
    fullscreenControllerRef.current?.clearNotice();
    gameStateRef.current?.closeSettings();
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    audioRef.current?.unlock();
    void fullscreenControllerRef.current?.toggle().then((res) => {
      if (res.mode === 'viewport') {
        try {
          window.scrollTo(0, 1);
        } catch {
          // Ignore scroll restriction
        }
      }
      schedulePhaserScaleSync();
    });
  }, [schedulePhaserScaleSync]);

  const handleUpdateAudioSettings = useCallback((partial: Partial<AudioSettings>) => {
    const gs = gameStateRef.current!;
    const audio = audioRef.current!;
    audio.unlock();
    gs.updateAudioSettings(partial);
    const updated = gs.getSnapshot().audioSettings;
    audio.applySettings(updated);
  }, []);

  const handleToggleMute = useCallback(() => {
    const gs = gameStateRef.current!;
    const cur = gs.getSnapshot().audioSettings;
    handleUpdateAudioSettings({ muted: !cur.muted });
  }, [handleUpdateAudioSettings]);

  const handleTogglePause = useCallback(() => {
    gameStateRef.current?.togglePause();
  }, []);

  const handleReturnMainMenu = useCallback(() => {
    audioRef.current?.stopAllGameplayAudio();
    gameStateRef.current?.returnToMainMenu();
  }, []);

  const handleSubmitNotebookAnswer = useCallback(
    (notebookId: number, selectedKey: AnswerChoiceKey): boolean => {
      if (!bridgeRef.current) return false;
      return bridgeRef.current.scene.handleNotebookAnswerFromUI(notebookId, selectedKey);
    },
    []
  );

  const handleUseItemSlot = useCallback((slotIndex: number) => {
    audioRef.current?.unlock();
    bridgeRef.current?.scene.useInventorySlot(slotIndex);
  }, []);

  const handlePlaytimeJumpButton = useCallback(() => {
    audioRef.current?.unlock();
    bridgeRef.current?.scene.triggerPlaytimeJumpFromUI();
  }, []);

  const handlePlaytimeUseScissors = useCallback(() => {
    audioRef.current?.unlock();
    const slot = gameStateRef.current?.inventory.findFirstSlotOfType(ItemType.SCISSORS) ?? -1;
    if (slot !== -1) {
      bridgeRef.current?.scene.useInventorySlot(slot);
    }
  }, []);

  const handleVirtualMoveChange = useCallback((nx: number, ny: number) => {
    bridgeRef.current?.scene.setVirtualMove(nx, ny);
  }, []);

  const handleVirtualSprintChange = useCallback((active: boolean) => {
    if (active) {
      audioRef.current?.unlock();
    }
    bridgeRef.current?.scene.setVirtualSprint(active);
  }, []);

  const handleVirtualInteract = useCallback(() => {
    bridgeRef.current?.scene.triggerVirtualInteract();
  }, []);

  const handleVirtualJump = useCallback(() => {
    bridgeRef.current?.scene.triggerVirtualJump();
  }, []);

  const isMenuState = snapshot.state === GameState.MAIN_MENU;
  const showHUD =
    snapshot.state === GameState.PLAYING ||
    snapshot.state === GameState.FINAL_ESCAPE ||
    snapshot.state === GameState.PRINCIPAL_DETENTION ||
    snapshot.state === GameState.PLAYTIME_CHALLENGE ||
    snapshot.state === GameState.NOTEBOOK_QUESTION ||
    snapshot.state === GameState.PAUSED;

  const showTouchControls =
    controlMode === 'touch' &&
    (snapshot.state === GameState.PLAYING ||
      snapshot.state === GameState.FINAL_ESCAPE ||
      snapshot.state === GameState.PLAYTIME_CHALLENGE ||
      snapshot.state === GameState.PRINCIPAL_DETENTION);

  return (
    <main
      ref={mainContainerRef}
      className={`fixed inset-0 w-screen h-screen h-dvh overflow-hidden bg-neutral-950 ${
        fullscreenSnap.isFullscreen ? 'z-10' : ''
      }`}
    >
      {/* Isolated Phaser 3 2D Top-Down Canvas Container */}
      <div
        id="phaser-mount"
        ref={mountRef}
        data-testid="game-canvas-container"
        className="w-full h-full"
      />

      {/* Start Menu, Mathematics Revision Notes & Dedicated Rules Panel */}
      {isMenuState && !isRulesOpen && !isNotesOpen && (
        <StartMenu
          controlMode={controlMode}
          onPlay={handleStartNewGame}
          onOpenNotes={handleOpenNotes}
          onOpenRules={handleOpenRules}
          onOpenSettings={handleOpenSettings}
        />
      )}
      {isMenuState && isNotesOpen && <MathNotesModal onBack={handleCloseNotes} />}
      {isMenuState && isRulesOpen && (
        <RulesModal controlMode={controlMode} onBack={handleCloseRules} />
      )}

      {/* Persistent In-Game HUD */}
      {showHUD && (
        <GameHUD
          snapshot={snapshot}
          controlMode={controlMode}
          onUseItemSlot={handleUseItemSlot}
          onTriggerInteract={handleVirtualInteract}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
        />
      )}

      {/* Touchscreen Virtual Joystick & Action Buttons (Hidden on Desktop/Laptop) */}
      {showTouchControls && (
        <TouchControls
          snapshot={snapshot}
          onMoveChange={handleVirtualMoveChange}
          onSprintChange={handleVirtualSprintChange}
          onInteract={handleVirtualInteract}
          onJump={handleVirtualJump}
        />
      )}

      {/* Character Dialogue Box */}
      {snapshot.dialogue &&
        snapshot.state !== GameState.VICTORY &&
        snapshot.state !== GameState.GAME_OVER &&
        snapshot.state !== GameState.PLAYTIME_CHALLENGE && (
          <DialogueBox dialogue={snapshot.dialogue} controlMode={controlMode} />
        )}

      {/* Mathematics Form 1 Kadaran Notebook Question Interface */}
      {snapshot.state === GameState.NOTEBOOK_QUESTION &&
        snapshot.activeNotebookId !== null && (
          <NotebookInterface
            notebookId={snapshot.activeNotebookId}
            controlMode={controlMode}
            onSubmitAnswer={handleSubmitNotebookAnswer}
          />
        )}

      {/* Playtime 3-Jump Rope Challenge */}
      {snapshot.state === GameState.PLAYTIME_CHALLENGE && (
        <PlaytimeOverlay
          playtime={snapshot.playtime}
          controlMode={controlMode}
          hasScissors={snapshot.inventory.includes(ItemType.SCISSORS)}
          onJumpButton={handlePlaytimeJumpButton}
          onUseScissors={handlePlaytimeUseScissors}
        />
      )}

      {/* Pause Modal */}
      {snapshot.state === GameState.PAUSED && (
        <PauseMenu
          onResume={handleTogglePause}
          onOpenSettings={handleOpenSettings}
          onRestart={handleStartNewGame}
          onMainMenu={handleReturnMainMenu}
        />
      )}

      {/* Settings Modal */}
      {snapshot.state === GameState.SETTINGS && (
        <SettingsMenu
          settings={snapshot.audioSettings}
          controlMode={controlMode}
          isFullscreen={fullscreenSnap.isFullscreen}
          fullscreenNotice={fullscreenSnap.notice}
          onToggleFullscreen={handleToggleFullscreen}
          onUpdateSettings={handleUpdateAudioSettings}
          onClose={handleCloseSettings}
        />
      )}

      {/* Game Over Screen */}
      {snapshot.state === GameState.GAME_OVER && (
        <GameOverScreen
          summary={snapshot.runSummary}
          onPlayAgain={handleStartNewGame}
          onMainMenu={handleReturnMainMenu}
        />
      )}

      {/* Victory Screen */}
      {snapshot.state === GameState.VICTORY && (
        <VictoryScreen
          summary={snapshot.runSummary}
          onPlayAgain={handleStartNewGame}
          onMainMenu={handleReturnMainMenu}
        />
      )}
    </main>
  );
}
