'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { LoaderCircle } from 'lucide-react'

interface ModuleTransitionOverlayProps {
  sectionLabel: string
}

export function ModuleTransitionOverlay({ sectionLabel }: ModuleTransitionOverlayProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/70 px-6 py-8 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-2xl border border-border/70 bg-card/95 p-6 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/12 text-accent">
            <LoaderCircle className="h-5 w-5 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-medium text-accent">Loading module</p>
            <h3 className="text-lg font-semibold text-foreground">Preparing {sectionLabel}</h3>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-4 rounded-xl border border-border/60 bg-background/60 p-4">
            <Skeleton className="h-10 w-56 bg-accent/12" />
            <Skeleton className="h-28 w-full bg-accent/10" />
            <Skeleton className="h-28 w-full bg-accent/10" />
          </div>
          <div className="space-y-4 rounded-xl border border-border/60 bg-background/60 p-4">
            <Skeleton className="h-8 w-40 bg-accent/12" />
            <Skeleton className="h-16 w-full bg-accent/10" />
            <Skeleton className="h-16 w-full bg-accent/10" />
            <Skeleton className="h-16 w-full bg-accent/10" />
          </div>
        </div>
      </div>
    </div>
  )
}