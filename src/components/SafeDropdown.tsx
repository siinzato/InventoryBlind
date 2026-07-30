// Safe Dropdown Component - Renders via Portal to avoid clipping issues

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  divider?: boolean;
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
  const [position, setPosition] = useState<DropdownPosition>({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

    const handleClickOutside = (event: MouseEvent) => {
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
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
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
      className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
    >
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {item.divider && <div className="h-px bg-zinc-700" />}
          <button
            onClick={() => handleItemClick(item)}
            className={`w-full px-4 py-2.5 text-left text-sm font-medium flex items-center gap-2 transition ${
              item.active
                ? 'bg-emerald-600 text-white'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            {item.icon}
            {item.label}
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
