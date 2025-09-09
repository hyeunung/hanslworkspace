
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const startY = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);
  
  const threshold = 80; // 새로고침 트리거 거리
  
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    
    let touchStartY = 0;
    let touchEndY = 0;
    
    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        touchStartY = e.touches[0].clientY;
        startY.current = touchStartY;
        setIsPulling(true);
      }
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling || isRefreshing) return;
      
      touchEndY = e.touches[0].clientY;
      const distance = touchEndY - touchStartY;
      
      if (distance > 0 && window.scrollY === 0) {
        e.preventDefault();
        setPullDistance(Math.min(distance, threshold * 1.5));
      }
    };
    
    const handleTouchEnd = async () => {
      if (pullDistance >= threshold && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(threshold);
        
        try {
          await onRefresh();
        } catch (error) {
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
      setIsPulling(false);
    };
    
    // 마우스 이벤트 (데스크톱 테스트용)
    const handleMouseDown = (e: MouseEvent) => {
      if (window.scrollY === 0) {
        touchStartY = e.clientY;
        startY.current = touchStartY;
        setIsPulling(true);
      }
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isPulling || isRefreshing) return;
      
      touchEndY = e.clientY;
      const distance = touchEndY - touchStartY;
      
      if (distance > 0 && window.scrollY === 0) {
        e.preventDefault();
        setPullDistance(Math.min(distance, threshold * 1.5));
      }
    };
    
    const handleMouseUp = async () => {
      if (pullDistance >= threshold && !isRefreshing) {
        setIsRefreshing(true);
        setPullDistance(threshold);
        
        try {
          await onRefresh();
        } catch (error) {
        } finally {
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
      setIsPulling(false);
    };
    
    // 이벤트 리스너 등록
    content.addEventListener('touchstart', handleTouchStart, { passive: false });
    content.addEventListener('touchmove', handleTouchMove, { passive: false });
    content.addEventListener('touchend', handleTouchEnd);
    
    // 데스크톱 테스트용
    content.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      content.removeEventListener('touchstart', handleTouchStart);
      content.removeEventListener('touchmove', handleTouchMove);
      content.removeEventListener('touchend', handleTouchEnd);
      content.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPulling, pullDistance, isRefreshing, onRefresh]);
  
  const rotation = (pullDistance / threshold) * 180;
  const opacity = Math.min(pullDistance / threshold, 1);
  
  return (
    <div className="relative">
      {/* Pull indicator */}
      <div 
        className="absolute left-0 right-0 flex justify-center items-center transition-all duration-200 z-10"
        style={{
          top: `${pullDistance - 40}px`,
          opacity: opacity,
        }}
      >
        <div className={`p-2 bg-white rounded-full shadow-lg ${isRefreshing ? 'animate-spin' : ''}`}>
          <RefreshCw 
            className="w-6 h-6 text-hansl-600"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: isRefreshing ? 'none' : 'transform 0.2s'
            }}
          />
        </div>
      </div>
      
      {/* Content */}
      <div 
        ref={contentRef}
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling ? 'none' : 'transform 0.3s'
        }}
      >
        {children}
      </div>
    </div>
  );
}