import React, { useEffect, useRef } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  // Restrict the inner card width; the shell defaults to a comfortable form
  // size (max-w-md). Pass any Tailwind max-w-* class to override.
  maxWidthClass?: string;
  // When false, Escape and backdrop clicks are ignored. Used for mid-submit
  // flows where dismissing would orphan in-flight work.
  dismissable?: boolean;
  // Accessibility label / id wiring. Pass the id of the visible heading via
  // labelledBy whenever possible so SR users hear it on focus.
  labelledBy?: string;
  describedBy?: string;
  // Extra classes appended to the inner shell (e.g. padding tweaks).
  shellClassName?: string;
  // Force-disable the backdrop click handler even when dismissable. Useful
  // for wizards that should only close via an explicit Cancel/Done button.
  closeOnBackdropClick?: boolean;
  // Opt out of the default p-6 padding when the modal owns its own
  // section layout (header + body + footer with custom spacing).
  padded?: boolean;
}

// Canonical app modal: backdrop fade + glass-shell pop, Escape dismiss,
// focus trap, restore focus on close. Wraps the `.modal-backdrop` +
// `.modal-shell` CSS classes so every modal shares identical look + a11y.
export function Modal({
  open,
  onClose,
  children,
  maxWidthClass = 'max-w-md',
  dismissable = true,
  labelledBy,
  describedBy,
  shellClassName = '',
  closeOnBackdropClick = true,
  padded = true,
}: ModalProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEscapeKey(onClose, open && dismissable);

  // Capture the focused element on open and restore it on close so
  // dismissing the dialog returns the user to the trigger (button/link)
  // they came from instead of dropping focus to <body>.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the shell so the first Tab keeps the user inside.
    const shell = shellRef.current;
    if (shell) {
      const focusables = shell.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusables[0];
      if (first) {
        first.focus();
      } else {
        shell.focus();
      }
    }
    return () => {
      const prev = previousActiveRef.current;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open]);

  // Trap Tab cycling so it never escapes the modal. Keeps SR + keyboard
  // users from landing in the (visually obscured) background UI.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const shell = shellRef.current;
      if (!shell) return;
      const focusables = Array.from(
        shell.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('aria-hidden'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !shell.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dismissable || !closeOnBackdropClick) return;
    // Only when the user clicked the backdrop itself, not bubbled from the shell.
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="modal-backdrop animate-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`modal-shell rounded-2xl ${padded ? 'p-6' : ''} ${maxWidthClass} w-full mx-4 animate-modal-glass ${shellClassName}`.trim().replace(/\s+/g, ' ')}
      >
        {children}
      </div>
    </div>
  );
}
