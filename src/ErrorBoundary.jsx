import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { hasError:false, error:null };
  }
  static getDerivedStateFromError(error){
    return { hasError:true, error };
  }
  componentDidCatch(error, info){
    // eslint-disable-next-line no-console
    console.error("Word Garden crashed:", error, info);
  }
  render(){
    if(this.state.hasError){
      return (
        <div style={{ padding:16, fontFamily:"system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
          <div style={{ maxWidth:560, margin:"0 auto", background:"#fff", borderRadius:16, padding:16, border:"1px solid rgba(0,0,0,0.08)" }}>
            <div style={{ fontWeight:900, fontSize:18 }}>Something went wrong</div>
            <div style={{ marginTop:8, color:"#7a1f1f", whiteSpace:"pre-wrap" }}>
              {String(this.state.error?.message || this.state.error || "Unknown error")}
            </div>
            <div style={{ marginTop:10, color:"#555", fontSize:13, lineHeight:1.5 }}>
              Tip: open Netlify → Functions logs or Safari DevTools Console to see the full error.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
