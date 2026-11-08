// Display formatting is separate from the YYYY-MM-DD / HH:mm values used by rules.
const pad=n=>String(n).padStart(2,'0');
function parts(value=Date.now()) {return new Date(value+8*3600000).toISOString().slice(0,16).split('T');}
function dateLabel(date) {
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
 if(!match)return date || '';
 const stamp=Date.UTC(+match[1],+match[2]-1,+match[3]);
 if(new Date(stamp).toISOString().slice(0,10)!==date)return date;
 return date+'（周'+['日','一','二','三','四','五','六'][new Date(stamp).getUTCDay()]+'）';
}
function dateTimeLabel(value) {const [date,time]=parts(value);return dateLabel(date)+' '+time;}
function rangeLabel(start,end) {const [date,time]=parts(start),[endDate,endTime]=parts(end);return dateLabel(date)+' '+time+'—'+(date===endDate?'':dateLabel(endDate)+' ')+endTime;}
function options(from,to,label) {return Array.from({length:to-from+1},(_,i)=>({value:from+i,label:label(from+i)}));}
function pickerState(mode,value,start='',end='') {
 if(mode==='time') {
  const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '') || /^([01]\d|2[0-3]):([0-5]\d)$/.exec(parts()[1]);
  const minuteIndex=Math.floor(Number(match[2])/10);
  const minutes=options(0,5,n=>pad(n*10)+'分').map(row=>({...row,value:row.value*10}));
  return {columns:[options(0,23,n=>pad(n)+'时'),minutes],indices:[+match[1],minuteIndex],draft:match[1]+':'+pad(minuteIndex*10)};
 }
 const valid=date=>/^\d{4}-\d{2}-\d{2}$/.test(date || '') && dateLabel(date)!==date;
 const min=valid(start)?start:'1900-01-01',max=valid(end)?end:'2100-12-31';
 let date=valid(value)?value:parts()[0];date=date<min?min:date>max?max:date;
 const [year,month,day]=date.split('-').map(Number),[minY,minM,minD]=min.split('-').map(Number),[maxY,maxM,maxD]=max.split('-').map(Number);
 const monthFrom=year===minY?minM:1,monthTo=year===maxY?maxM:12;
 const dayFrom=year===minY && month===minM?minD:1,dayTo=year===maxY && month===maxM?maxD:new Date(Date.UTC(year,month,0)).getUTCDate();
 return {columns:[options(minY,maxY,n=>n+'年'),options(monthFrom,monthTo,n=>pad(n)+'月'),options(dayFrom,dayTo,n=>pad(n)+'日'+dateLabel(year+'-'+pad(month)+'-'+pad(n)).slice(10))],indices:[year-minY,month-monthFrom,day-dayFrom],draft:date};
}
function movePicker(mode,state,indices,start='',end='') {
 const values=state.columns.map((column,i)=>column[Math.max(0,Math.min(Number(indices[i]) || 0,column.length-1))].value);
 if(mode==='time')return pickerState(mode,pad(values[0])+':'+pad(values[1]));
 const maxDay=new Date(Date.UTC(values[0],values[1],0)).getUTCDate();
 return pickerState(mode,values[0]+'-'+pad(values[1])+'-'+pad(Math.min(values[2],maxDay)),start,end);
}
module.exports={dateLabel,dateTimeLabel,rangeLabel,pickerState,movePicker};
