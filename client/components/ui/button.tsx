import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';

// Local shadcn/ui button shape, adapted to Deckmate tokens (2026-11-03).
// https://ui.shadcn.com/docs/components/button
export function Button({ asChild = false, variant = 'default', size = 'default', className = '', ...props }:
  ComponentProps<'button'> & { asChild?: boolean; variant?: 'default' | 'outline' | 'ghost'; size?: 'default' | 'sm' | 'icon' }) {
  const Component = asChild ? Slot : 'button';
  return <Component className={`ui-button button-${variant} button-size-${size} ${className}`} {...props} />;
}
