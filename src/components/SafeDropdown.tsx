// Safe Dropdown Component - Renders via Portal to avoid clipping issues

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

interface DropdownItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  divider?: boolean;
  disabled?: boolean;
}

interface SafeDropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  active?: boolean;
  className?: string;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

export const SafeDropdown: React.FC<SafeDropdownProps> = ({
  trigger,
  items,
  active,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Drive the open transition: mount at scale 0.98/opacity 0, then flip to
  // entered on the next frame so the transition class change actually animates.
  useEffect(() => {
    if (!isOpen) {
      setEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Calculate position of the dropdown
  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.left;
      let top = rect.bottom + 8; // 8px gap

      // Check if dropdown would go off right edge
      const dropdownWidth = 200; // min-width of dropdown
      if (left + dropdownWidth > viewportWidth - 16) {
        left = viewportWidth - dropdownWidth - 16;
      }

      // Check if dropdown would go off bottom edge
      const dropdownHeight = items.length * 40 + 16; // approximate height
      if (top + dropdownHeight > viewportHeight - 16 && rect.top > dropdownHeight) {
        top = rect.top - dropdownHeight - 8; // Open above
      }

      setPosition({
        top,
        left: Math.max(16, left),
        width: Math.max(rect.width, dropdownWidth),
      });
    }
  }, [items.length]);

  // Update position when opened
  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    const handleScroll = () => {
      updatePosition();
    };

    const handleResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, updatePosition]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen(prev => !prev);
  };

  const handleItemClick = (item: DropdownItem) => {
    item.onClick();
    setIsOpen(false);
  };

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: position.width,
        minWidth: '200px',
        zIndex: 2000,
      }}
      className={`origin-top-right bg-surface-2/95 backdrop-blur-xl border border-edge/70 rounded-container shadow-overlay py-1.5 overflow-hidden transition-all duration-200 ease-out ${
        entered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
      }`}
    >
      {items.map((item) => (
        <React.Fragment key={item.id}>
          {item.divider && <div className="my-1 mx-2 h-px bg-edge/70" />}
          <button
            onClick={() => !item.disabled && handleItemClick(item)}
            disabled={item.disabled}
            className={`w-[calc(100%-12px)] mx-1.5 my-0.5 px-2.5 py-2 rounded-lg text-left text-sm font-medium flex items-center gap-2 transition-colors duration-150 ${
              item.disabled
                ? 'text-fg-subtle/60 cursor-not-allowed'
                : item.active
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-muted hover:bg-surface-3/80 hover:text-fg cursor-pointer'
            }`}
          >
            <span className="flex-shrink-0 [&>svg]:w-[14px] [&>svg]:h-[14px]">{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.active && <Check size={14} className="flex-shrink-0 text-accent" />}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div ref={triggerRef} className={`relative ${className}`}>
      <div onClick={handleToggle} className="cursor-pointer">
        {trigger}
      </div>

      {/* Render dropdown via portal to avoid clipping */}
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
};
