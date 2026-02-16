import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

interface SwipeableCardProps {
  children: ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Make the card focusable for keyboard navigation */
  tabIndex?: number;
  /** Accessible label for the card */
  ariaLabel?: string;
}

const SWIPE_THRESHOLD = 80; // px to trigger action
const MAX_SWIPE = 150; // max visual displacement

export default function SwipeableCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = 'Approve',
  leftLabel = 'Reject',
  disabled = false,
  className = '',
  tabIndex,
  ariaLabel,
}: SwipeableCardProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [swipeResult, setSwipeResult] = useState<'approve' | 'reject' | null>(null);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const isSwipingRef = useRef(false);
  const disabledRef = useRef(disabled);
  const isAnimatingRef = useRef(isAnimating);

  // Keep refs in sync
  disabledRef.current = disabled;
  isAnimatingRef.current = isAnimating;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isAnimating) return;
    const touch = e.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    isHorizontalSwipe.current = null;
    isSwipingRef.current = true;
    setIsSwiping(true);
  }, [disabled, isAnimating]);

  // Use native event listener for touchmove to avoid passive listener issue
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (!isSwipingRef.current || disabledRef.current || isAnimatingRef.current) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = touch.clientY - touchStartY.current;

      // Determine swipe direction on first significant movement
      if (isHorizontalSwipe.current === null) {
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        if (absDeltaX > 10 || absDeltaY > 10) {
          isHorizontalSwipe.current = absDeltaX > absDeltaY;
        }
      }

      // Only handle horizontal swipes
      if (isHorizontalSwipe.current === false) {
        return;
      }

      if (isHorizontalSwipe.current === true) {
        // Prevent vertical scrolling during horizontal swipe
        e.preventDefault();
      }

      // Clamp offset
      const clampedOffset = Math.max(-MAX_SWIPE, Math.min(MAX_SWIPE, deltaX));
      setOffsetX(clampedOffset);
    };

    // Add as non-passive to allow preventDefault
    el.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchmove', handleNativeTouchMove);
    };
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping || disabled || isAnimating) return;
    setIsSwiping(false);
    isSwipingRef.current = false;

    const absOffset = Math.abs(offsetX);

    if (absOffset >= SWIPE_THRESHOLD) {
      // Trigger action
      if (offsetX > 0 && onSwipeRight) {
        setSwipeResult('approve');
        setIsAnimating(true);
        // Animate out to the right
        setOffsetX(window.innerWidth);
        setTimeout(() => {
          onSwipeRight();
          setOffsetX(0);
          setIsAnimating(false);
          setSwipeResult(null);
        }, 300);
      } else if (offsetX < 0 && onSwipeLeft) {
        setSwipeResult('reject');
        setIsAnimating(true);
        // Animate out to the left
        setOffsetX(-window.innerWidth);
        setTimeout(() => {
          onSwipeLeft();
          setOffsetX(0);
          setIsAnimating(false);
          setSwipeResult(null);
        }, 300);
      } else {
        // Snap back
        setOffsetX(0);
      }
    } else {
      // Snap back
      setOffsetX(0);
    }

    isHorizontalSwipe.current = null;
  }, [isSwiping, disabled, isAnimating, offsetX, onSwipeRight, onSwipeLeft]);

  // Calculate visual effects based on offset
  const progress = Math.abs(offsetX) / SWIPE_THRESHOLD;
  const isApproving = offsetX > 0;
  const isRejecting = offsetX < 0;
  const pastThreshold = Math.abs(offsetX) >= SWIPE_THRESHOLD;

  // Background color opacity based on swipe progress
  const bgOpacity = Math.min(progress * 0.3, 0.3);

  // Rotation based on offset (subtle tilt effect)
  const rotation = (offsetX / MAX_SWIPE) * 5;

  // Keyboard handler: allow keyboard-driven approve/reject
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled || isAnimating) return;
    // Don't intercept if focus is on a child button, input, textarea, or select
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'button' || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return;
    }
    // 'a' key for approve (swipe right), 'r' key for reject (swipe left)
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      if (onSwipeRight) onSwipeRight();
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      if (onSwipeLeft) onSwipeLeft();
    }
  }, [disabled, isAnimating, onSwipeRight, onSwipeLeft]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg ${className} ${tabIndex !== undefined ? 'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900' : ''}`}
      style={{ touchAction: isSwiping && isHorizontalSwipe.current ? 'none' : 'pan-y' }}
      tabIndex={tabIndex}
      role={tabIndex !== undefined ? 'article' : undefined}
      aria-label={ariaLabel}
      onKeyDown={tabIndex !== undefined ? handleKeyDown : undefined}
    >
      {/* Swipe action indicators behind the card */}
      <div className="absolute inset-0 flex items-center justify-between px-6 pointer-events-none">
        {/* Left side - Approve indicator (shown when swiping right) */}
        <div
          className={`flex items-center gap-2 transition-opacity duration-150 ${
            isApproving && progress > 0.2 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm ${
            pastThreshold && isApproving
              ? 'bg-green-500 text-white scale-110'
              : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
          } transition-all duration-150`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            {rightLabel}
          </div>
        </div>

        {/* Right side - Reject indicator (shown when swiping left) */}
        <div
          className={`flex items-center gap-2 transition-opacity duration-150 ${
            isRejecting && progress > 0.2 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm ${
            pastThreshold && isRejecting
              ? 'bg-red-500 text-white scale-110'
              : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
          } transition-all duration-150`}>
            {leftLabel}
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        </div>
      </div>

      {/* The card itself */}
      <div
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`relative z-10 ${isAnimating ? 'transition-transform duration-300 ease-out' : isSwiping ? '' : 'transition-transform duration-200 ease-out'}`}
        style={{
          transform: `translateX(${offsetX}px) rotate(${rotation}deg)`,
          backgroundColor: swipeResult === 'approve'
            ? `rgba(34, 197, 94, ${bgOpacity})`
            : swipeResult === 'reject'
              ? `rgba(239, 68, 68, ${bgOpacity})`
              : isApproving
                ? `rgba(34, 197, 94, ${bgOpacity})`
                : isRejecting
                  ? `rgba(239, 68, 68, ${bgOpacity})`
                  : undefined,
          borderRadius: 'inherit',
        }}
      >
        {children}

        {/* Swipe hint overlay at card edges */}
        {isSwiping && isApproving && progress > 0.3 && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg transition-all"
            style={{
              backgroundColor: pastThreshold ? 'rgb(34, 197, 94)' : 'rgba(34, 197, 94, 0.5)',
              width: pastThreshold ? '4px' : '2px',
            }}
          />
        )}
        {isSwiping && isRejecting && progress > 0.3 && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 rounded-r-lg transition-all"
            style={{
              backgroundColor: pastThreshold ? 'rgb(239, 68, 68)' : 'rgba(239, 68, 68, 0.5)',
              width: pastThreshold ? '4px' : '2px',
            }}
          />
        )}
      </div>

      {/* Mobile swipe hint - only shown on first card */}
      {!isSwiping && !isAnimating && offsetX === 0 && (
        <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-1 pointer-events-none lg:hidden">
          <div className="swipe-hint-indicator flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-300">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16l-4-4m0 0l4-4m-4 4h18" />
            </svg>
            swipe
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
