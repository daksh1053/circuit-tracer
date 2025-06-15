window.initCgFeatureDetail = async function({visState, renderAll, data, cgSel}){
  var sel = cgSel.select('.feature-detail').html('')
  if (!sel.node()) return

  var headerSel = sel.append('div.feature-header')
  var logitsSel = sel.append('div.logits-container')
  var examplesSel = sel.append('div.feature-examples-container')
  var featureExamples = await window.initFeatureExamples({
    containerSel: examplesSel,
    showLogits: true,
    // showLogits: !data.nodes.some(d => d.top_logit_effects) // we show logits ourselves frozen above the feature vis, don't also show it inside
  })

  let editOpen = false;

  // throttle to prevent lag when mousing over
  var renderFeatureExamples = util.throttleDebounce(featureExamples.renderFeature, 200)

  async function loadFeatureLabel(featureIndex) {
    if (window.isLocalServing) {
      try {
        const response = await fetch(`/features_label?index=${featureIndex}`);
        if (response.ok) {
          const data = await response.json();
          console.log("loadFeatureLabel", data)
          return data.label;
        }
      } catch (error) {
        console.error('Error fetching feature label:', error);
        return null;
      }
    }
    return null;
  }

  async function saveFeatureLabel(featureIndex, label) {
    if (window.isLocalServing) {
      try {
        const response = await fetch('/save_label', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            index: featureIndex,
            label: label
          })
        });
        if (response.ok) {
          const data = await response.json();
          console.log("saveFeatureLabel", data);
          return true;
        }
      } catch (error) {
        console.error('Error saving feature label:', error);
        return false;
      }
    }
    return false;
  }

  function renderFeatureDetail() {
    logitsSel.html('').st({display:''})

    // display hovered then clicked nodes, with fallbacks for supernode
    var d = data.nodes.find(e => e.nodeId === visState.hoveredNodeId)
    if (!d) d = data.nodes.find(e => e.nodeId === visState.clickedId)
    if (!d){
      var featureId = visState.hoveredId
      if (!featureId || featureId.includes('supernode')){
        headerSel.html('')
          .append('div.no-selected-feature').text("Click or hover to see a feature's examples")
        examplesSel.st({opacity: 0})
        return
      } 
      return
    }
    
    var label = d.isTmpFeature ? d.featureId : 
      visState.isHideLayer ? `#F${d.featureIndex}` : 
      `${utilCg.layerLocationLabel(d.layer, d.probe_location_idx)}/${d.featureIndex}`

    if (d.isError || d.feature_type == 'embedding' || d.feature_type == 'logit'){
      if (d.isError) addLogits(d)
      if (d.feature_type=='logit') addEmbeddings(d)

      headerSel.html('').append('div.header-top-row').append('div.feature-title')
        .text(d.ppClerp)
      examplesSel.st({opacity: 0})
    } else if (d.feature_type == 'cross layer transcoder') {
      const scan = data.metadata.scan?.startsWith('custom-') ? data.metadata.transcoder_list[d.layer] : data.metadata.scan;
      addLogits(d)
      addEmbeddings(d)
      var headerTopRowSel = headerSel.html('').append('div.header-top-row')

      const currentActivation = d.activation

      const actText = typeof currentActivation == 'number' ? currentActivation.toFixed(2) : 'N/A'
      const featureTitleSel = headerTopRowSel.append('div.feature-title')
        .html(`Feature&nbsp;<a style="color: inherit;" href="${d.url}" target="_blank">${label}</a> <span style="font-size: 0.9em; color: #777;">Act: ${actText}</span>`)

      const featureDataPromise = featureExamples.loadFeature(scan, d.featureIndex);
      
      if (typeof currentActivation == 'number') {
        window.renderActHistogram({
          featureTitleSel,
          scan,
          featureNode: d,
          featureExamples,
          featureDataPromise,
        })
      }

      loadFeatureLabel(d.featureIndex).then(loadedLabel => {
          console.log("label", loadedLabel)
          d.localClerp = loadedLabel;
          d.ppClerp = loadedLabel;
          const featureTitleLink = featureTitleSel.select('a');
          if (document.activeElement !== featureTitleLink.node()) {
            featureTitleLink.text(loadedLabel);
          }
      });

      headerTopRowSel.append('div.pp-clerp')
        .text(d => d.ppClerp)
        .at({title: d.ppClerp})

      if (visState.isEditMode){
        headerTopRowSel.append('button.edit-clerp-button')
          .text('Edit')
          .on('click', toggleEdit)
        
        headerTopRowSel.append('button.save-clerp-button')
          .text('Save')
          .st({marginLeft: '5px'})
          .on('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            
            const inputValue = headerSel.select('input').node()?.value;
            if (inputValue && d.featureIndex !== undefined) {
              const success = await saveFeatureLabel(d.featureIndex, inputValue);
              if (success) {
                d.localClerp = inputValue;
                d.ppClerp = inputValue;
                // Update the feature title
                const featureTitleLink = featureTitleSel.select('a');
                if (featureTitleLink.node()) {
                  featureTitleLink.text(inputValue);
                }
                // Close edit mode after successful save
                editOpen = false;
                hClerpEditSel.st({display: 'none'});
              }
            }
          })
  
        function toggleEdit() {
          editOpen = !editOpen;
          hClerpEditSel.st({display: editOpen ? 'flex' : 'none'})
          if (editOpen) {
            headerSel.select('input').node()?.focus();
          }
        }
  
        const hClerpEditSel = headerSel.append('div.clerp-edit')
          .st({ display: editOpen ? 'flex' : 'none' });
  
        const hClerpSel = hClerpEditSel.append('div')
          .st({ display: 'flex' });
        hClerpSel.append('div')
          .st({flex: '0 0 50px'})
          .text(`🧑💻`);
        hClerpSel.append('input').data([d])
          .at({ value: d.localClerp })
          .st({flex: '1 0 0', whiteSpace: 'normal', fontSize: 12})
          .on('change', ev => {
            renderAll.hClerpUpdate([d, ev.target.value]);
          })
  
        // const rClerpSel = hClerpEditSel.append('div')
        //     .st({ display: 'flex' });
        //   rClerpSel.append('div')
        //     .st({flex: '0 0 50px'})
        //     .text(`🧑☁️`);
        //   rClerpSel.append('div')
        //     .text(d.remoteClerp)
        //     .st({flex: '1 0', whiteSpace: 'normal'})
  
        // const clerpSel = hClerpEditSel.append('div')
        //   .st({ display: 'flex' });
        // clerpSel.append('div')
        //   .st({flex: '0 0 50px'})
        //   .text(`🤖💬`);
        // clerpSel.append('div')
        //   .text(d.clerp)
        //   .st({ flex: '1 0', whiteSpace: 'normal' })
      }

      featureExamples.loadFeature(scan, d.featureIndex)
      renderFeatureExamples(scan, d.featureIndex)
      examplesSel.st({opacity: 1})
    } else {
      headerSel.html(`<b>${label}</b>`)
      logitsSel.html('No logit data')
      examplesSel.st({opacity: 0})
    }

    // add pinned/click state and toggle to feature-title
    headerSel.select('div.feature-title')
      .classed('pinned', d.nodeId && visState.pinnedIds.includes(d.nodeId))
      .classed('hovered', visState.clickedId == d.nodeId)
      .on('click', ev => {
        utilCg.clickFeature(visState, renderAll, d, ev.metaKey || ev.ctrlKey)

        if (visState.clickedId) return
        // double render to toggle on hoveredId, could expose more of utilCg.clickFeature to prevent
        visState.hoveredId = d.featureId
        renderAll.hoveredId()
      })

  }

  function addLogits(d) {
    // return
    if (!d || !d.top_logit_effects) return logitsSel.html('').st({display: 'none'})
    // Add logit effects section
    let logitRowContainerSel = logitsSel.st({display: ''})
      .append('div.effects')
      .appendMany('div.sign', [d.top_logit_effects, d.bottom_logit_effects].filter(d => d))
    logitRowContainerSel.append('div.label').text((d, i) => i ? 'Bottom Outputs' : 'Top Outputs')
    logitRowContainerSel.append('div.rows')
      .appendMany('div.row', d => d)
      .append('span.key').text(d => d)
  }
  function addEmbeddings(d) { 
    // return
    // Add embedding effects section
    if (d.top_embedding_effects || d.bottom_embedding_effects) {
      let embeddingRowContainerSel = logitsSel
        .append('div.effects')
        .appendMany('div.sign', [d.top_embedding_effects, d.bottom_embedding_effects].filter(d => d))
      embeddingRowContainerSel.append('div.label').text((d, i) => i ? 'Bottom Inputs' : 'Top Inputs')
      embeddingRowContainerSel.append('div.rows').appendMany('div.row', d => d)
        .append('span.key').text(d => d)
    }
  }

  renderAll.hClerpUpdate.fns.push(renderFeatureDetail)
  renderAll.clickedId.fns.push(renderFeatureDetail)
  renderAll.hoveredId.fns.push(renderFeatureDetail)
  renderAll.pinnedIds.fns.push(renderFeatureDetail)

  renderFeatureDetail()
}

window.init?.()
