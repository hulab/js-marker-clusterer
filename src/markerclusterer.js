/**
 * @name MarkerClusterer for Google Maps v3
 * @author Luke Mahe
 * @author emersion
 * @fileoverview
 * The library creates and manages per-zoom-level clusters for large amounts of
 * markers.
 */

/**
 * Extends a objects prototype by anothers.
 * @param {Object} obj1 The object to be extended.
 * @param {Object} obj2 The object to extend with.
 * @return {Object} The new extended object.
 * @ignore
 */
var extend = function(obj1, obj2) {
	return (function(object) {
		for (var property in object.prototype) {
			this.prototype[property] = object.prototype[property];
		}
		return this;
	}).apply(obj1, [obj2]);
};

/**
 * A Marker Clusterer that clusters markers.
 * @param {google.maps.Map} map The Google map to attach to.
 * @param {Array.<google.maps.Marker>=} markers Optional markers to add to
 *	 the cluster.
 * @param {Object=} options support the following options:
 * * `gridSize`: (number) The grid size of a cluster in pixels.
 * * `maxZoom`: (number) The maximum zoom level that a marker can be part of a
 *   cluster.
 * * `zoomOnClick`: (boolean) Whether the default behaviour of clicking on a
 *   cluster is to zoom into it.
 * * `averageCenter`: (boolean) Wether the center of each cluster should be
 *   the average of all markers in the cluster.
 * * `minimumClusterSize`: (number) The minimum number of markers to be in a
 *   cluster before the markers are hidden and a count
 *   is shown.
 * @constructor
 * @extends google.maps.OverlayView
 */
function MarkerClusterer(map, markers, options) {
	// MarkerClusterer implements google.maps.OverlayView interface.
	extend(MarkerClusterer, google.maps.OverlayView);

	this.map_ = map;

	this.markers_ = [];
	this.clusters_ = [];
	this.ready_ = false;

	this.tree_ = rbush(options.maxMarkers, ['[0]', '[1]', '[0]', '[1]']);

	options = options || {};

	this.gridSize = options.gridSize || 60;
	this.minClusterSize = options.minimumClusterSize || 2;
	this.maxZoom = options.maxZoom || null;
	this.zoomOnClick = options.zoomOnClick || true;
	this.averageCenter = options.averageCenter || false;
	this.isClusterable = options.isClusterable || function (marker) { return true; };
	this.iconGenerator = options.iconGenerator || function (markers) { return markers.length; };
	this.clusterWidth = options.width;
	this.clusterHeight = options.height;
	this.anchor = options.anchor;

	this.setMap(map);

	var that = this;

	var prevZoom = this.map_.getZoom();
	var zoomChanged = false;
	google.maps.event.addListener(this.map_, 'zoom_changed', function () {
		var zoom = that.map_.getZoom();
		if (zoom != zoomChanged) {
			zoomChanged = true;
		}
	});

	// Add the map event listeners
	google.maps.event.addListener(this.map_, 'idle', function () {
		if (zoomChanged) {
			that.repaint();
		} else {
			that.redraw();
		}
	});

	// Finally, add the markers
	if (markers && markers.length) {
		this.addMarkers(markers, false);
	}
}

// Anchor align constants

var xalign = {
	LEFT: 0x0,
	CENTER: 0x1,
	RIGHT: 0x2
};

var yalign = {
	TOP: 0x00,
	CENTER: 0x10,
	BOTTOM: 0x20
};

MarkerClusterer.TOP_LEFT = xalign.LEFT | yalign.TOP;
MarkerClusterer.TOP = xalign.CENTER | yalign.TOP;
MarkerClusterer.TOP_RIGHT = xalign.RIGHT | yalign.TOP;

MarkerClusterer.CENTER_LEFT = xalign.LEFT | yalign.CENTER;
MarkerClusterer.CENTER = xalign.CENTER | yalign.CENTER;
MarkerClusterer.CENTER_RIGHT = xalign.RIGHT | yalign.CENTER;

MarkerClusterer.BOTTOM_LEFT = xalign.LEFT | yalign.BOTTOM;
MarkerClusterer.BOTTOM = xalign.CENTER | yalign.BOTTOM;
MarkerClusterer.BOTTOM_RIGHT = xalign.RIGHT | yalign.BOTTOM;

/**
 * Implementaion of the interface method.
 * @ignore
 */
MarkerClusterer.prototype.onAdd = function() {
	this.setReady_(true);
};

/**
 * Implementaion of the interface method.
 * @ignore
 */
MarkerClusterer.prototype.draw = function() {};

/**
 * Fit the map to the bounds of the markers in the clusterer.
 */
MarkerClusterer.prototype.fitMapToMarkers = function() {
	var markers = this.getMarkers();
	var bounds = new google.maps.LatLngBounds();
	for (var i = 0, marker; marker = markers[i]; i++) {
		bounds.extend(marker.getPosition());
	}

	this.map_.fitBounds(bounds);
};


/**
 * Returns the array of markers in the clusterer.
 * @return {Array.<google.maps.Marker>} The markers.
 */
MarkerClusterer.prototype.getMarkers = function() {
	return this.markers_;
};


/**
 * Returns the number of markers in the clusterer
 * @return {Number} The number of markers.
 */
MarkerClusterer.prototype.getTotalMarkers = function() {
	return this.markers_.length;
};

function getMarkerNode(marker) {
	var pos = marker.getPosition();
	return [pos.lat(), pos.lng(), marker];
}

/**
 * Adds a marker to the clusterer and redraws if needed.
 * @param {google.maps.Marker} marker The marker to add.
 * @param {boolean=} nodraw Whether to redraw the clusters.
 */
MarkerClusterer.prototype.addMarker = function(marker, nodraw) {
	this.pushMarkerTo_(marker);
	this.tree_.insert(getMarkerNode(marker));

	if (!nodraw) {
		this.redraw();
	}
};

/**
 * Add an array of markers to the clusterer.
 * @param {Array.<google.maps.Marker>} markers The markers to add.
 * @param {boolean=} nodraw Whether to redraw the clusters.
 */
MarkerClusterer.prototype.addMarkers = function(markers, nodraw) {
	for (var i = 0, marker; marker = markers[i]; i++) {
		this.pushMarkerTo_(marker);
	}

	this.tree_.load(markers.map(getMarkerNode));

	if (!nodraw) {
		this.redraw();
	}
};


/**
 * Pushes a marker to the clusterer.
 * @param {google.maps.Marker} marker The marker to add.
 * @private
 */
MarkerClusterer.prototype.pushMarkerTo_ = function(marker) {
	marker.isAdded = false;
	if (marker['draggable']) {
		// If the marker is draggable add a listener so we update the clusters on
		// the drag end.
		var that = this;
		google.maps.event.addListener(marker, 'dragend', function() {
			marker.isAdded = false;
			that.repaint();
		});
	}

	this.markers_.push(marker);
};


/**
 * Removes a marker and returns true if removed, false if not
 * @param {google.maps.Marker} marker The marker to remove
 * @return {boolean} Whether the marker was removed or not
 * @private
 */
MarkerClusterer.prototype.removeMarker_ = function(marker) {
	var index = this.markers_.indexOf(marker);

	if (index === -1) {
		// Marker is not in our list of markers.
		return false;
	}

	marker.setMap(null);

	this.markers_.splice(index, 1);

	// Remove node from tree
	// TODO: optimize this!
	var nodes = this.tree_.all();
	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		if (node[2] === marker) {
			this.tree_.remove(node);
		}
	}

	return true;
};


/**
 * Remove a marker from the cluster.
 * @param {google.maps.Marker} marker The marker to remove.
 * @param {boolean=} opt_nodraw Optional boolean to force no redraw.
 * @return {boolean} True if the marker was removed.
 */
MarkerClusterer.prototype.removeMarker = function(marker, opt_nodraw) {
	var removed = this.removeMarker_(marker);

	if (!opt_nodraw && removed) {
		this.resetViewport();
		this.redraw();
		return true;
	} else {
	 return false;
	}
};


/**
 * Removes an array of markers from the cluster.
 * @param {Array.<google.maps.Marker>} markers The markers to remove.
 * @param {boolean=} nodraw Optional boolean to force no redraw.
 */
MarkerClusterer.prototype.removeMarkers = function(markers, nodraw) {
	var removed = false;

	for (var i = 0, marker; marker = markers[i]; i++) {
		var r = this.removeMarker_(marker);
		removed = removed || r;
	}

	if (!nodraw && removed) {
		this.resetViewport();
		this.redraw();
		return true;
	} else {
	 return false;
	}
};


/**
 * Clears all clusters and markers from the clusterer.
 */
MarkerClusterer.prototype.clearMarkers = function(nodraw) {
	this.resetViewport(true);

	// Set the markers a empty array.
	this.markers_ = [];

	this.tree_.clear();

	if (!nodraw) {
		this.redraw();
	}
};


/**
 * Sets the clusterer's ready state.
 * @param {boolean} ready The state.
 * @private
 */
MarkerClusterer.prototype.setReady_ = function(ready) {
	if (!this.ready_) {
		this.ready_ = ready;
		this.createClusters_();
	}
};


/**
 * Returns the number of clusters in the clusterer.
 * @return {number} The number of clusters.
 */
MarkerClusterer.prototype.getTotalClusters = function() {
	return this.clusters_.length;
};


/**
 * Returns the google map that the clusterer is associated with.
 * @return {google.maps.Map} The map.
 */
MarkerClusterer.prototype.getMap = function() {
	return this.map_;
};


/**
 * Sets the google map that the clusterer is associated with.
 * @param {google.maps.Map} map The map.
 */
MarkerClusterer.prototype.setMap = function(map) {
	this.map_ = map;
};


/**
 * Extends a bounds object by the grid size.
 * @param {google.maps.LatLngBounds} bounds The bounds to extend.
 * @return {google.maps.LatLngBounds} The extended bounds.
 */
MarkerClusterer.prototype.getExtendedBounds = function(bounds) {
	var projection = this.getProjection();

	// Turn the bounds into latlng.
	var tr = new google.maps.LatLng(bounds.getNorthEast().lat(),
			bounds.getNorthEast().lng());
	var bl = new google.maps.LatLng(bounds.getSouthWest().lat(),
			bounds.getSouthWest().lng());

	// Convert the points to pixels and the extend out by the grid size.
	var trPix = projection.fromLatLngToDivPixel(tr);
	trPix.x += this.gridSize;
	trPix.y -= this.gridSize;

	var blPix = projection.fromLatLngToDivPixel(bl);
	blPix.x -= this.gridSize;
	blPix.y += this.gridSize;

	// Convert the pixel points back to LatLng
	var ne = projection.fromDivPixelToLatLng(trPix);
	var sw = projection.fromDivPixelToLatLng(blPix);

	// Extend the bounds to contain the new bounds.
	bounds.extend(ne);
	bounds.extend(sw);

	return bounds;
};


/**
 * Clears all existing clusters and recreates them.
 * @param {boolean} reset To also remove markers.
 */
MarkerClusterer.prototype.resetViewport = function(reset) {
	// Remove all the clusters
	for (var i = 0, cluster; cluster = this.clusters_[i]; i++) {
		cluster.remove();
	}

	// Reset the markers to not be added and to be invisible.
	for (var i = 0, marker; marker = this.markers_[i]; i++) {
		marker.isAdded = false;
		if (reset) {
			marker.setMap(null);
		}
	}

	this.clusters_ = [];
};

MarkerClusterer.prototype.repaint = function() {
	this.resetViewport();
	this.redraw();
};


/**
 * Redraws the clusters.
 */
MarkerClusterer.prototype.redraw = function() {
	this.createClusters_();
};

MarkerClusterer.prototype.getMarkerCluster = function (marker) {
	if (!marker.isAdded) return null;

	for (var i = 0; i < this.clusters_.length; i++) {
		var cluster = this.clusters_[i];

		if (cluster.isMarkerAlreadyAdded(marker)) {
			return cluster;
		}
	}

	return null;
};

MarkerClusterer.prototype.removeCluster = function (cluster) {
	for (var i = 0; i < this.clusters_.length; i++) {
		if (cluster === this.clusters_[i]) {
			cluster.remove();
			this.clusters_.splice(i, 1);
			return;
		}
	}
};


function boundsToArray(bounds) {
	var ne = bounds.getNorthEast();
	var sw = bounds.getSouthWest();

	return [
		Math.min(ne.lat(), sw.lat()),
		Math.min(ne.lng(), sw.lng()),
		Math.max(ne.lat(), sw.lat()),
		Math.max(ne.lng(), sw.lng())
	];
}

/**
 * Creates the clusters.
 * @private
 */
MarkerClusterer.prototype.createClusters_ = function() {
	if (!this.ready_) {
		return;
	}

	// Get our current map view bounds.
	// Create a new bounds object so we don't affect the map.
	var mapBounds = this.map_.getBounds();
	mapBounds = new google.maps.LatLngBounds(mapBounds.getSouthWest(), mapBounds.getNorthEast());
	mapBounds = this.getExtendedBounds(mapBounds);

	for (var i = 0, marker; marker = this.markers_[i]; i++) {
		if (marker.isAdded) continue;

		var pos = marker.getPosition();
		if (!mapBounds.contains(pos)) continue;
		if (!this.isClusterable(marker)) continue;

		// Create a new cluster for this marker
		var cluster = new Cluster(this);
		cluster.addMarker(marker);

		// Calculate cluster bounds
		var bounds = new google.maps.LatLngBounds(pos, pos);
		bounds = this.getExtendedBounds(bounds);

		// Get markers in the cluster bounds
		var nodes = this.tree_.search(boundsToArray(bounds));
		for (var j = 0; j < nodes.length; j++) {
			var m = nodes[j][2];

			if (m.isAdded) continue;
			if (!this.isClusterable(m)) continue;

			cluster.addMarker(m);
		}

		this.clusters_.push(cluster);
	}
};


/**
 * A cluster that contains markers.
 * @param {MarkerClusterer} markerClusterer The markerclusterer that this
 * cluster is associated with.
 * @constructor
 * @ignore
 */
function Cluster(markerClusterer) {
	this.markerClusterer_ = markerClusterer;
	this.map_ = markerClusterer.getMap();
	this.gridSize = markerClusterer.gridSize;
	this.minClusterSize = markerClusterer.minClusterSize;
	this.averageCenter = markerClusterer.averageCenter;
	this.center_ = null;
	this.markers_ = [];
	this.bounds_ = null;
	this.clusterIcon_ = new ClusterIcon(this, markerClusterer.iconGenerator, markerClusterer.gridSize);

	if (markerClusterer.clusterWidth && markerClusterer.clusterHeight) {
		this.clusterIcon_.width = markerClusterer.clusterWidth;
		this.clusterIcon_.height = markerClusterer.clusterHeight;
	}
	if (markerClusterer.anchor) {
		this.clusterIcon_.anchor = markerClusterer.anchor;
	}
}

/**
 * Determins if a marker is already added to the cluster.
 * @param {google.maps.Marker} marker The marker to check.
 * @return {boolean} True if the marker is already added.
 */
Cluster.prototype.isMarkerAlreadyAdded = function(marker) {
	return (this.markers_.indexOf(marker) != -1);
};


/**
 * Add a marker the cluster.
 * @param {google.maps.Marker} marker The marker to add.
 * @return {boolean} True if the marker was added.
 */
Cluster.prototype.addMarker = function(marker) {
	if (this.isMarkerAlreadyAdded(marker)) {
		return false;
	}

	if (!this.center_) {
		this.center_ = marker.getPosition();
		this.calculateBounds_();
	} else {
		if (this.averageCenter) {
			var l = this.markers_.length + 1;
			var lat = (this.center_.lat() * (l-1) + marker.getPosition().lat()) / l;
			var lng = (this.center_.lng() * (l-1) + marker.getPosition().lng()) / l;
			this.center_ = new google.maps.LatLng(lat, lng);
			this.calculateBounds_();
		}
	}

	marker.isAdded = true;
	this.markers_.push(marker);

	var len = this.markers_.length;
	if (len < this.minClusterSize && marker.getMap() != this.map_) {
		// Min cluster size not reached so show the marker.
		marker.setMap(this.map_);
	}

	if (len == this.minClusterSize) {
		// Hide the markers that were showing.
		for (var i = 0; i < len; i++) {
			this.markers_[i].setMap(null);
		}
	}

	if (len >= this.minClusterSize) {
		marker.setMap(null);
	}

	this.updateIcon();
	return true;
};

Cluster.prototype.removeMarker = function (marker) {
	var i = this.markers_.indexOf(marker);
	if (i == -1) return false;

	marker.isAdded = false;

	this.markers_.splice(i, 1);
	return true;
};


/**
 * Returns the marker clusterer that the cluster is associated with.
 * @return {MarkerClusterer} The associated marker clusterer.
 */
Cluster.prototype.getMarkerClusterer = function() {
	return this.markerClusterer_;
};


/**
 * Returns the bounds of the cluster.
 * @return {google.maps.LatLngBounds} the cluster bounds.
 */
Cluster.prototype.getBounds = function() {
	var bounds = new google.maps.LatLngBounds(this.center_, this.center_);
	for (var i = 0, marker; marker = this.markers_[i]; i++) {
		bounds.extend(marker.getPosition());
	}
	return bounds;
};


/**
 * Removes the cluster
 */
Cluster.prototype.remove = function() {
	this.clusterIcon_.remove();
	this.markers_.length = 0;
	delete this.markers_;
};


/**
 * Returns the center of the cluster.
 * @return {number} The cluster center.
 */
Cluster.prototype.getSize = function() {
	return this.markers_.length;
};


/**
 * Returns the center of the cluster.
 * @return {Array.<google.maps.Marker>} The cluster center.
 */
Cluster.prototype.getMarkers = function() {
	return this.markers_;
};


/**
 * Returns the center of the cluster.
 * @return {google.maps.LatLng} The cluster center.
 */
Cluster.prototype.getCenter = function() {
	return this.center_;
};


/**
 * Calculated the extended bounds of the cluster with the grid.
 * @private
 */
Cluster.prototype.calculateBounds_ = function() {
	var bounds = new google.maps.LatLngBounds(this.center_, this.center_);
	this.bounds_ = this.markerClusterer_.getExtendedBounds(bounds);
};


/**
 * Determines if a marker lies in the clusters bounds.
 * @param {google.maps.Marker} marker The marker to check.
 * @return {boolean} True if the marker lies in the bounds.
 */
Cluster.prototype.isMarkerInClusterBounds = function(marker) {
	return this.bounds_.contains(marker.getPosition());
};


/**
 * Returns the map that the cluster is associated with.
 * @return {google.maps.Map} The map.
 */
Cluster.prototype.getMap = function() {
	return this.map_;
};


/**
 * Updates the cluster icon
 */
Cluster.prototype.updateIcon = function() {
	var zoom = this.map_.getZoom();
	var mz = this.markerClusterer_.maxZoom;

	if (mz && zoom > mz) {
		// The zoom is greater than our max zoom so show all the markers in cluster.
		for (var i = 0, marker; marker = this.markers_[i]; i++) {
			marker.setMap(this.map_);
		}
		return;
	}

	if (this.markers_.length < this.minClusterSize) {
		// Min cluster size not yet reached.
		this.clusterIcon_.hide();
		return;
	}

	this.clusterIcon_.center = this.center_;
	this.clusterIcon_.show();
};


/**
 * A cluster icon.
 * @param {Cluster} cluster The cluster to be associated with.
 * @param {Function} iconGenerator A function that generates cluster icons.
 * @constructor
 * @extends google.maps.OverlayView
 * @ignore
 */
function ClusterIcon(cluster, iconGenerator) {
	extend(ClusterIcon, google.maps.OverlayView);

	this.cluster_ = cluster;
	this.iconGenerator = iconGenerator;
	this.center = null;
	this.map_ = cluster.getMap();
	this.div_ = null;
	this.visible_ = false;

	this.width = 0;
	this.height = 0;

	this.setMap(this.map_);
}


/**
 * Triggers the clusterclick event and zoom's if the option is set.
 */
ClusterIcon.prototype.triggerClusterClick = function() {
	var markerClusterer = this.cluster_.getMarkerClusterer();

	// Trigger the clusterclick event.
	google.maps.event.trigger(markerClusterer, 'clusterclick', this.cluster_);

	if (markerClusterer.zoomOnClick) {
		// Zoom into the cluster.
		this.map_.fitBounds(this.cluster_.getBounds());
	}
};


/**
 * Adding the cluster icon to the dom.
 * @ignore
 */
ClusterIcon.prototype.onAdd = function() {
	this.div_ = document.createElement('div');
	if (this.visible_) {
		var pos = this.getPosFromLatLng_(this.center);
		this.div_.style.cssText = this.createCss(pos);
	}

	var panes = this.getPanes();
	panes.overlayMouseTarget.appendChild(this.div_);

	var that = this;
	google.maps.event.addDomListener(this.div_, 'click', function() {
		that.triggerClusterClick();
	});
};


/**
 * Returns the position to place the div dending on the latlng.
 * @param {google.maps.LatLng} latlng The position in latlng.
 * @return {google.maps.Point} The position in pixels.
 * @private
 */
ClusterIcon.prototype.getPosFromLatLng_ = function(latlng) {
	var pos = this.getProjection().fromLatLngToDivPixel(latlng);

	var width = this.width || 0,
		height = this.height || 0,
		anchor = this.anchor || MarkerClusterer.CENTER;

	if (anchor & xalign.CENTER) {
		pos.x -= width / 2;
	}
	if (anchor & xalign.RIGHT) {
		pos.x -= width;
	}

	if (anchor & yalign.CENTER) {
		pos.y -= height / 2;
	}
	if (anchor & yalign.BOTTOM) {
		pos.y -= height;
	}

	return pos;
};


/**
 * Draw the icon.
 * @ignore
 */
ClusterIcon.prototype.draw = function() {
	if (this.visible_) {
		var pos = this.getPosFromLatLng_(this.center);
		this.div_.style.top = pos.y + 'px';
		this.div_.style.left = pos.x + 'px';

		var content = this.iconGenerator(this.cluster_.markers_);
		if (typeof content === 'object') {
			this.div_.innerHTML = '';
			this.div_.appendChild(content);
		} else {
			this.div_.innerHTML = content;
		}
	}
};


/**
 * Hide the icon.
 */
ClusterIcon.prototype.hide = function() {
	if (this.div_) {
		this.div_.style.display = 'none';
	}
	this.visible_ = false;
};


/**
 * Position and show the icon.
 */
ClusterIcon.prototype.show = function() {
	if (this.div_) {
		var pos = this.getPosFromLatLng_(this.center);
		this.div_.style.cssText = this.createCss(pos);
		this.div_.style.display = '';
	}
	this.visible_ = true;
};


/**
 * Remove the icon from the map
 */
ClusterIcon.prototype.remove = function() {
	this.setMap(null);
};


/**
 * Implementation of the onRemove interface.
 * @ignore
 */
ClusterIcon.prototype.onRemove = function() {
	if (this.div_ && this.div_.parentNode) {
		this.hide();
		this.div_.parentNode.removeChild(this.div_);
		this.div_ = null;
	}
};


/**
 * Create the css text based on the position of the icon.
 * @param {google.maps.Point} pos The position.
 * @return {string} The css style text.
 */
ClusterIcon.prototype.createCss = function(pos) {
	return 'cursor:pointer; position:absolute; top:' + pos.y + 'px; left:' + pos.x + 'px;'
		+ 'height:' + this.height_ + 'px; width:' + this.width_ + 'px;';
};
