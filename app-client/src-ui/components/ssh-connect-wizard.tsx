'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LiveSshTerminal } from '@/components/live-ssh-terminal'
import { 
  Server, 
  User, 
  KeyRound, 
  Check,
  ArrowRight, 
  ArrowLeft,
  ChevronRight,
  AlertCircle,
  Terminal,
  Power,
  RotateCcw
} from 'lucide-react'
import { useSsh, ConnectionStep } from '@/hooks/useSsh'
import { upsertServerEntry } from '@/hooks/useServers'
import { SshSessionRequest, VaultEntry } from '@/lib/types'

interface SshConnectWizardProps {
  onSessionTitleChange?: (title: string | null) => void
  connectionPreset?: Partial<SshSessionRequest> | null
  connectionRequestId?: number
  onConnectionPresetConsumed?: (requestId: number) => void
}

function createVaultEntryFromConnection(draftConnection: Partial<VaultEntry> & {
  host?: string
  port?: number
  username?: string
  password?: string
  privateKeyPem?: string
  privateKeyPassphrase?: string
  certificatePem?: string
  knownHostFingerprint?: string
  profileName?: string
}) {
  const host = draftConnection.host?.trim()
  const username = draftConnection.username?.trim()

  if (!host || !username) {
    return null
  }

  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${host}-${draftConnection.port ?? 22}-${username}`,
    name: draftConnection.profileName?.trim() || host,
    host,
    port: draftConnection.port ?? 22,
    username,
    password: draftConnection.password || undefined,
    privateKeyPem: draftConnection.privateKeyPem?.trim() ?? '',
    privateKeyPassphrase: draftConnection.privateKeyPassphrase?.trim() || undefined,
    certificatePem: draftConnection.certificatePem?.trim() || undefined,
    knownHostFingerprint: draftConnection.knownHostFingerprint?.trim() || undefined,
  } satisfies VaultEntry
}

export function SshConnectWizard({
  onSessionTitleChange,
  connectionPreset,
  connectionRequestId,
  onConnectionPresetConsumed,
}: SshConnectWizardProps) {
  const { 
    activeStep, 
    draftConnection, 
    activeSessionId,
    sessionStatus,
    sessionMessage,
    sessionError,
    terminalOutput,
    updateDraft, 
    nextStep, 
    prevStep, 
    connect,
    sendTerminalInput,
    resizeTerminal,
    closeActiveSession,
    resetWizard,
    setActiveStep,
  } = useSsh()
  const processedConnectionRequestIdRef = useRef<number | null>(null)

  const steps: { id: ConnectionStep; label: string; icon: any }[] = [
    { id: 'ip', label: 'Host & Port', icon: Server },
    { id: 'user', label: 'Auth User', icon: User },
    { id: 'password', label: 'Credentials', icon: KeyRound },
    { id: 'connected', label: 'Terminal', icon: Terminal },
  ]

  const currentVisualStep: ConnectionStep = activeStep === 'connecting' ? 'connected' : activeStep
  const currentStepOrder = steps.findIndex((step) => step.id === currentVisualStep)
  const isTerminalStage = activeStep === 'connected'

  const connectAndPersist = async (overrideDraft?: Partial<SshSessionRequest>) => {
    const nextDraft = {
      ...draftConnection,
      ...overrideDraft,
    }
    const serverEntry = createVaultEntryFromConnection(nextDraft)

    if (serverEntry) {
      await upsertServerEntry(serverEntry)
    }

    await connect(overrideDraft)
  }

  useEffect(() => {
    const title = activeSessionId && draftConnection.host ? draftConnection.host : null
    onSessionTitleChange?.(title)

    return () => {
      onSessionTitleChange?.(null)
    }
  }, [activeSessionId, draftConnection.host, onSessionTitleChange])

  useEffect(() => {
    if (sessionStatus !== 'connected' || !activeSessionId) {
      return
    }

    const serverEntry = createVaultEntryFromConnection(draftConnection)
    if (!serverEntry) {
      return
    }

    void upsertServerEntry(serverEntry)
  }, [sessionStatus, activeSessionId, draftConnection])

  useEffect(() => {
    if (!connectionPreset || connectionRequestId === undefined) {
      return
    }

    if (processedConnectionRequestIdRef.current === connectionRequestId) {
      return
    }

    processedConnectionRequestIdRef.current = connectionRequestId
    onConnectionPresetConsumed?.(connectionRequestId)

    updateDraft(connectionPreset)

    const canAutoConnect = Boolean(connectionPreset.password?.trim() || connectionPreset.privateKeyPem?.trim())

    if (canAutoConnect) {
      void connectAndPersist(connectionPreset)
      return
    }

    setActiveStep('password')
  }, [connectionPreset, connectionRequestId, onConnectionPresetConsumed, setActiveStep, updateDraft])

  const renderStepContent = () => {
    switch (activeStep) {
      case 'search':
        return (
          <div className="flex flex-col items-center justify-center py-12 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="w-20 h-20 rounded-3xl bg-accent/10 flex items-center justify-center mb-6 shadow-sm border border-accent/20">
              <Terminal className="w-10 h-10 text-accent" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-3">Nueva Conexión SSH</h2>
            <p className="text-muted-foreground max-w-sm mb-8">
              Inicia una sesión segura en tu servidor. Sigue los pasos para configurar los detalles de acceso.
            </p>
            <Button 
              className="bg-accent hover:bg-accent/90 text-accent-foreground px-8 py-6 text-lg rounded-xl shadow-lg"
              onClick={nextStep}
            >
              Comenzar Asistente
              <ChevronRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )
      case 'ip':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-muted-foreground ml-1">DIRECCIÓN HOST</label>
                <div className="relative group">
                  <Server className="absolute left-3 top-3 h-5 w-5 text-muted-foreground group-focus-within:text-accent transition-colors" />
                  <Input 
                    value={draftConnection.host || ''} 
                    onChange={e => updateDraft({ host: e.target.value })}
                    placeholder="ej. 192.168.1.100 o server.com"
                    className="pl-11 h-12 bg-secondary/30 border-border/50 focus:ring-1 focus:ring-accent rounded-xl"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-muted-foreground ml-1">PUERTO</label>
                <Input 
                  type="number"
                  value={draftConnection.port || 22} 
                  onChange={e => updateDraft({ port: parseInt(e.target.value) })}
                  className="h-12 bg-secondary/30 border-border/50 focus:ring-1 focus:ring-accent rounded-xl"
                />
              </div>
            </div>
            <Button disabled={!draftConnection.host} onClick={nextStep} className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl text-lg font-bold">
              Siguiente: Usuario
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )
      case 'user':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-muted-foreground ml-1">NOMBRE DE USUARIO</label>
                <div className="relative group">
                  <User className="absolute left-3 top-3 h-5 w-5 text-muted-foreground group-focus-within:text-accent transition-colors" />
                  <Input 
                    value={draftConnection.username || ''} 
                    onChange={e => updateDraft({ username: e.target.value })}
                    placeholder="ej. root o ubuntu"
                    className="pl-11 h-12 bg-secondary/30 border-border/50 focus:ring-1 focus:ring-accent rounded-xl"
                  />
                </div>
              </div>
            <Button disabled={!draftConnection.username} onClick={nextStep} className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl text-lg font-bold">
              Siguiente: Credenciales
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        )
      case 'password':
        return (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
             <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-muted-foreground ml-1">CONTRASEÑA (OPCIONAL SI RESPONDIDAS POR LLAVE)</label>
                <div className="relative group">
                  <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground group-focus-within:text-accent transition-colors" />
                  <Input 
                    type="password"
                    value={draftConnection.password || ''} 
                    onChange={e => updateDraft({ password: e.target.value })}
                    placeholder="••••••••"
                    className="pl-11 h-12 bg-secondary/30 border-border/50 focus:ring-1 focus:ring-accent rounded-xl"
                  />
                </div>
              </div>
            <Button onClick={() => void connectAndPersist()} className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl text-lg font-bold shadow-lg shadow-accent/20">
              CONECTAR AHORA
              <Zap className="w-5 h-5 ml-2 fill-current" />
            </Button>
          </div>
        )
      case 'connecting':
        if (sessionStatus === 'error' && sessionError) {
          return (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-destructive/20 bg-destructive/10 text-destructive">
                <AlertCircle className="h-10 w-10" />
              </div>
              <div className="space-y-2 text-center">
                <h3 className="text-xl font-bold text-foreground">{sessionError.title}</h3>
                <p className="text-sm text-muted-foreground">{sessionError.detail}</p>
                {sessionError.suggestion && (
                  <p className="text-xs text-muted-foreground">{sessionError.suggestion}</p>
                )}
              </div>
              <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Estado</p>
                <p className="mt-2 text-sm text-foreground">{sessionMessage}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={prevStep} className="flex-1 rounded-xl">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Corregir datos
                </Button>
                <Button onClick={() => void connectAndPersist()} className="flex-1 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reintentar
                </Button>
              </div>
            </div>
          )
        }

        if (sessionStatus === 'closed') {
          return (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
              <div className="space-y-2 text-center">
                <h3 className="text-xl font-bold text-foreground">Sesion cerrada</h3>
                <p className="text-sm text-muted-foreground">{sessionMessage}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={prevStep} className="flex-1 rounded-xl">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Volver
                </Button>
                <Button onClick={() => void connectAndPersist()} className="flex-1 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Intentar otra vez
                </Button>
              </div>
            </div>
          )
        }

        return (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-in zoom-in-95 duration-500">
            <div className="relative">
               <div className="w-24 h-24 rounded-full border-4 border-accent/20 border-t-accent animate-spin mb-8" />
               <Terminal className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-4 w-8 h-8 text-accent animate-pulse" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Estableciendo Conexión...</h3>
            <p className="text-muted-foreground">{sessionMessage || `Negociando protocolos con ${draftConnection.host}`}</p>
          </div>
        )
      case 'connected':
        return (
          <div className="flex h-full min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-border/60 bg-background text-foreground">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Terminal</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="max-w-full truncate font-semibold text-foreground">
                      {draftConnection.username}@{draftConnection.host}:{draftConnection.port}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      sessionStatus === 'closed'
                        ? 'bg-amber-500/10 text-amber-700'
                        : sessionStatus === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-emerald-500/10 text-emerald-700'
                    }`}>
                      {sessionStatus}
                    </span>
                    {activeSessionId ? (
                      <span className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
                        {activeSessionId.slice(0, 8)}
                      </span>
                    ) : null}
                    <span className="truncate text-xs text-muted-foreground/90">
                      {sessionMessage}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sessionStatus !== 'connected' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void connectAndPersist()}
                      className="border-border/60 bg-background text-foreground hover:bg-secondary"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reconectar
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void closeActiveSession()}
                    className="text-destructive hover:bg-secondary hover:text-destructive"
                  >
                    <Power className="mr-2 h-4 w-4" />
                    Desconectar
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 bg-background">
                <LiveSshTerminal
                  chunks={terminalOutput}
                  sessionStatus={sessionStatus}
                  onData={(value) => void sendTerminalInput(value)}
                  onResize={(cols, rows) => void resizeTerminal(cols, rows)}
                />
              </div>
            </div>

            {sessionStatus === 'closed' && (
              <div className="border border-border/70 bg-secondary/20 p-3 text-sm text-muted-foreground">
                La sesion se cerro. Puedes reconectar de inmediato desde la barra superior.
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className={`mx-auto flex h-full min-h-0 w-full flex-col ${isTerminalStage ? 'max-w-none' : 'max-w-xl justify-center'}`}>
      {activeStep !== 'search' && !isTerminalStage && (
        <div className={`flex items-center justify-between px-2 ${isTerminalStage ? 'mb-6' : 'mb-12'}`}>
          {steps.filter(s => s.id !== 'search').map((s, i) => {
            const stepOrder = steps.findIndex((step) => step.id === s.id)
            const isCompleted = stepOrder > -1 && stepOrder < currentStepOrder
            const isActive = s.id === currentVisualStep
            const StepIcon = isCompleted ? Check : s.icon

            return (
              <div key={s.id} className="flex flex-col items-center gap-2 group relative">
                 <div className={`
                    w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-300
                    ${isActive ? 'border-accent bg-accent text-accent-foreground shadow-lg scale-110' : 
                      isCompleted ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.16)] animate-in zoom-in-95 duration-300' : 'border-border/60 bg-secondary text-muted-foreground'}
                 `}>
                    <StepIcon className={`w-6 h-6 ${isCompleted ? 'animate-in zoom-in-95 duration-300' : ''}`} />
                 </div>
                 <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? 'text-accent' : isCompleted ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                   {s.label}
                 </span>
                 {i < steps.length - 2 && (
                   <div className={`absolute top-6 -right-[3.5rem] hidden h-[2px] w-8 md:block ${isCompleted ? 'bg-emerald-500/40' : 'bg-border/50'}`} />
                 )}
              </div>
            )
          })}
        </div>
      )}

      <div className={`${isTerminalStage ? 'flex min-h-0 flex-1 flex-col border border-border/60 bg-background p-0' : 'group relative overflow-hidden rounded-3xl border border-border/60 bg-card p-8 shadow-xl'}`}>
        {!isTerminalStage ? (
          <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-accent/5 blur-3xl pointer-events-none group-hover:bg-accent/10 transition-colors duration-700" />
        ) : null}
         
         <div className={`relative ${isTerminalStage ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
            {activeStep !== 'search' && activeStep !== 'connecting' && activeStep !== 'connected' && (
              <button 
                onClick={prevStep}
                className="mb-6 flex items-center text-sm font-medium text-muted-foreground hover:text-accent transition-colors"
                aria-label="Volver paso anterior"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Regresar
              </button>
            )}
            
            {renderStepContent()}
         </div>
      </div>
      
      {activeStep !== 'search' && activeStep !== 'connecting' && activeStep !== 'connected' && (
        <Button 
          variant="link" 
          onClick={resetWizard}
          className="mt-6 text-muted-foreground hover:text-destructive transition-colors text-xs"
        >
          Cancelar y salir del asistente
        </Button>
      )}
    </div>
  )
}

function Zap(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14.71 14.71 4l-4.71 4h5L4.29 18.71 9 14.71h-5z" />
    </svg>
  )
}
