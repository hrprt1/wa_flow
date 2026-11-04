import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva('inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium disabled:pointer-events-none [&_svg]:shrink-0', {
  variants: {
    variant: { default: 'primary', outline: 'border bg-transparent', ghost: 'icon-button' },
    size: { default: 'min-h-9 px-4 py-2', sm: 'min-h-8 px-3', icon: 'size-9 p-2' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export function Button({ className, variant, size, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
