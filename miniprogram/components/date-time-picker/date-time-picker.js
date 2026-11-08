const C=require('../../lib/calendar');
Component({
 properties:{mode:{type:String,value:'date'},value:{type:String,value:''},start:{type:String,value:''},end:{type:String,value:''},placeholder:{type:String,value:'请选择'},suffix:{type:String,value:''},centered:{type:Boolean,value:false},disabled:{type:Boolean,value:false}},
 data:{opened:false,columns:[],indices:[],draft:'',displayValue:'',moving:false},
 observers:{'value, mode':function(value,mode){this.setData({displayValue:mode==='date'?C.dateLabel(value):value});}},
 methods:{
  ignore(){},
  openPicker(){
   if(this.properties.disabled || this.data.opened)return;
   const state=C.pickerState(this.properties.mode,this.properties.value,this.properties.start,this.properties.end);
   this.setData({...state,opened:true,moving:false});this.triggerEvent('open');
  },
  closePicker(){this.setData({opened:false,moving:false});},
  wheelStart(){this.setData({moving:true});},
  wheelEnd(){this.setData({moving:false});},
  wheelChange(e){
   if(!this.data.opened)return;
   const state=C.movePicker(this.properties.mode,this.data,e.detail.value,this.properties.start,this.properties.end);
   // Do not rebuild stable columns or write picker indices back on every move:
   // this can interrupt the native wheel and reset its scroll position.
   const calendarChanged=this.properties.mode==='date' && state.draft.slice(0,7)!==this.data.draft.slice(0,7);
   this.setData(calendarChanged?{...state,moving:false}:{draft:state.draft,moving:false});
  },
  confirmPicker(){
   if(this.data.moving || !this.data.opened || this.properties.disabled)return;
   const value=this.data.draft;this.setData({opened:false});this.triggerEvent('change',{value});
  }
 }
});
