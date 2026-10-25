export function remainingSpoolPages(total:number,printed:number,duplex:boolean) {
  if(!Number.isInteger(total)||total<1||!Number.isInteger(printed)||printed<0||printed>=total)throw new Error('Enter the number of fully printed spool sides; at least one side must remain.')
  if(duplex && printed%2!==0)throw new Error('For automatic duplex, complete or reconcile the partially printed sheet first. Re-route only after an even number of spool sides.')
  return Array.from({length:total-printed},(_,i)=>printed+i+1)
}
