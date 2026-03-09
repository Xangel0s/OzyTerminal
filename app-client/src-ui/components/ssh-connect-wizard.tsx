'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Server, 
  User, 
  KeyRound, 
  ArrowRight, 
  ArrowLeft,
  ChevronRight,
  Loader2,
  Terminal
} from 'lucide-react'
import { useSsh, ConnectionStep } from '@/hooks/useSsh'

export function SshConnectWizard() {
  const { 
    activeStep, 
    draftConnection, 
    updateDraft, 
    nextStep, 
    prevStep, 
    resetWizard 
  } = useSsh()

  const steps: { id: ConnectionStep; label: string; icon: any }[] = [
    { id: 'ip', label: 'Host & Port', icon: Server },
    { id: 'user', label: 'Auth User', icon: User },
    { id: 'password', label: 'Credentials', icon: KeyRound },
    { id: 'connecting', label: 'Terminal', icon: Terminal },
  ]

  const activeIndex = steps.findIndex(s => s.id === activeStep)

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
            <Button onClick={nextStep} className="w-full h-12 bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl text-lg font-bold shadow-lg shadow-accent/20">
              CONECTAR AHORA
              <Zap className="w-5 h-5 ml-2 fill-current" />
            </Button>
          </div>
        )
      case 'connecting':
        return (
          <div className="flex flex-col items-center justify-center py-16 text-center animate-in zoom-in-95 duration-500">
            <div className="relative">
               <div className="w-24 h-24 rounded-full border-4 border-accent/20 border-t-accent animate-spin mb-8" />
               <Terminal className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -mt-4 w-8 h-8 text-accent animate-pulse" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Estableciendo Conexión...</h3>
            <p className="text-muted-foreground">Negociando protocolos con {draftConnection.host}</p>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="max-w-xl mx-auto h-full flex flex-col justify-center">
      {activeStep !== 'search' && (
        <div className="mb-12 flex items-center justify-between px-2">
          {steps.filter(s => s.id !== 'search').map((s, i) => {
            const stepIndex = steps.findIndex(st => st.id === s.id) - 1
            const isCompleted = i < activeIndex - 1
            const isActive = s.id === activeStep
            const StepIcon = s.icon

            return (
              <div key={s.id} className="flex flex-col items-center gap-2 group relative">
                 <div className={`
                    w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300
                    ${isActive ? 'bg-accent text-accent-foreground shadow-lg scale-110' : 
                      isCompleted ? 'bg-accent/20 text-accent' : 'bg-secondary text-muted-foreground'}
                 `}>
                    <StepIcon className="w-6 h-6" />
                 </div>
                 <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? 'text-accent' : 'text-muted-foreground'}`}>
                   {s.label}
                 </span>
                 {i < steps.length - 2 && (
                   <div className="absolute top-6 -right-[3.5rem] w-8 h-[2px] bg-border/50 hidden md:block" />
                 )}
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-card border border-border/60 rounded-3xl p-8 shadow-xl relative overflow-hidden group">
         {/* Decorative background element */}
         <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent/5 rounded-full blur-3xl pointer-events-none group-hover:bg-accent/10 transition-colors duration-700" />
         
         <div className="relative">
            {activeStep !== 'search' && activeStep !== 'connecting' && (
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
      
      {activeStep !== 'search' && activeStep !== 'connecting' && (
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
