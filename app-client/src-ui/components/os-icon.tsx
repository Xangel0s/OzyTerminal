'use client'

import type { IconType } from 'react-icons'
import { FaLinux, FaWindows } from 'react-icons/fa'
import {
  SiApple,
  SiCentos,
  SiDebian,
  SiFedora,
  SiRedhat,
  SiUbuntu,
} from 'react-icons/si'

export type HostOperatingSystem =
  | 'ubuntu'
  | 'debian'
  | 'windows'
  | 'macos'
  | 'centos'
  | 'fedora'
  | 'redhat'
  | 'linux'

type OperatingSystemConfig = {
  label: string
  icon: IconType
  iconClassName: string
  surfaceClassName: string
}

type OperatingSystemPattern = {
  os: HostOperatingSystem
  patterns: RegExp[]
}

const OPERATING_SYSTEMS: Record<HostOperatingSystem, OperatingSystemConfig> = {
  ubuntu: {
    label: 'Ubuntu',
    icon: SiUbuntu,
    iconClassName: 'text-orange-400',
    surfaceClassName: 'bg-orange-500/10',
  },
  debian: {
    label: 'Debian',
    icon: SiDebian,
    iconClassName: 'text-pink-400',
    surfaceClassName: 'bg-pink-500/10',
  },
  windows: {
    label: 'Windows',
    icon: FaWindows,
    iconClassName: 'text-sky-400',
    surfaceClassName: 'bg-sky-500/10',
  },
  macos: {
    label: 'macOS',
    icon: SiApple,
    iconClassName: 'text-slate-300',
    surfaceClassName: 'bg-slate-500/10',
  },
  centos: {
    label: 'CentOS',
    icon: SiCentos,
    iconClassName: 'text-violet-400',
    surfaceClassName: 'bg-violet-500/10',
  },
  fedora: {
    label: 'Fedora',
    icon: SiFedora,
    iconClassName: 'text-blue-400',
    surfaceClassName: 'bg-blue-500/10',
  },
  redhat: {
    label: 'Red Hat',
    icon: SiRedhat,
    iconClassName: 'text-red-400',
    surfaceClassName: 'bg-red-500/10',
  },
  linux: {
    label: 'Linux',
    icon: FaLinux,
    iconClassName: 'text-amber-300',
    surfaceClassName: 'bg-amber-500/10',
  },
}

const OPERATING_SYSTEM_PATTERNS: OperatingSystemPattern[] = [
  {
    os: 'ubuntu',
    patterns: [/\bubuntu\b/i, /\bcanonical\b/i],
  },
  {
    os: 'debian',
    patterns: [/\bdebian\b/i],
  },
  {
    os: 'windows',
    patterns: [
      /\bwindows\b/i,
      /\bwin(?:dows)?(?:-?server)?\b/i,
      /\bmicrosoft\b/i,
      /\bwin(?:10|11|2016|2019|2022)\b/i,
    ],
  },
  {
    os: 'macos',
    patterns: [/\bmac(?:os)?\b/i, /\bosx\b/i, /\bdarwin\b/i, /\bapple\b/i],
  },
  {
    os: 'centos',
    patterns: [/\bcentos\b/i],
  },
  {
    os: 'fedora',
    patterns: [/\bfedora\b/i],
  },
  {
    os: 'redhat',
    patterns: [/\bred\s?hat\b/i, /\brhel\b/i],
  },
  {
    os: 'linux',
    patterns: [/\blinux\b/i, /\bgnu\/linux\b/i, /\bec2-user\b/i, /\broot\b/i],
  },
]

export function detectOperatingSystem(value: string | undefined, fallback: HostOperatingSystem = 'linux'): HostOperatingSystem {
  if (!value) {
    return fallback
  }

  for (const matcher of OPERATING_SYSTEM_PATTERNS) {
    if (matcher.patterns.some((pattern) => pattern.test(value))) {
      return matcher.os
    }
  }

  return fallback
}

interface InferHostOperatingSystemInput {
  name?: string
  address?: string
  user?: string
  os?: HostOperatingSystem
}

export function inferHostOperatingSystem(
  input: InferHostOperatingSystemInput,
  fallback: HostOperatingSystem = 'linux',
): HostOperatingSystem {
  const combined = [input.name, input.address, input.user].filter(Boolean).join(' ')

  return detectOperatingSystem(combined, input.os ?? fallback)
}

export function detectRuntimeOperatingSystem(fallback: HostOperatingSystem = 'linux'): HostOperatingSystem {
  if (typeof navigator === 'undefined') {
    return fallback
  }

  const platform = [navigator.userAgent, navigator.platform].filter(Boolean).join(' ')

  return detectOperatingSystem(platform, fallback)
}

export function getOperatingSystemConfig(os: HostOperatingSystem): OperatingSystemConfig {
  return OPERATING_SYSTEMS[os] ?? OPERATING_SYSTEMS.linux
}

interface OperatingSystemIconProps {
  os: HostOperatingSystem
  className?: string
  containerClassName?: string
}

export function OperatingSystemIcon({
  os,
  className = 'h-5 w-5',
  containerClassName = 'h-10 w-10 rounded-lg',
}: OperatingSystemIconProps) {
  const { icon: Icon, iconClassName, surfaceClassName, label } = getOperatingSystemConfig(os)

  return (
    <div
      className={`flex items-center justify-center ${containerClassName} ${surfaceClassName}`}
      title={label}
      aria-label={label}
    >
      <Icon className={`${className} ${iconClassName}`} />
    </div>
  )
}