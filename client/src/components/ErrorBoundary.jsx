import { Component } from "react";
export default class ErrorBoundary extends Component{
  state={error:null};
  static getDerivedStateFromError(e){return {error:e};}
  componentDidCatch(e,info){console.error("UI crash",e,info);}
  render(){ if(this.state.error) return <div className="glass rounded-2xl p-8 text-center"><p className="font-display font-semibold text-rose-300">Something broke.</p><button onClick={()=>this.setState({error:null})} className="mt-3 rounded-full border border-white/15 px-4 py-1.5 text-sm hover:bg-white/10">Retry</button></div>; return this.props.children; }
}
