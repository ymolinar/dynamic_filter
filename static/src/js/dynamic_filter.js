odoo.define('dynamic_filter.DynamicSearchView', function (require) {
    // Requirements
    let SearchView = require('web.SearchView'),
        py_eval = require('web.pyeval'),
        core = require('web.core'),
        _t = core._t,
        search_inputs = require('web.search_inputs'),
        utils = require('dynamic_filter.Utils'),
        DomainParser = require('dynamic_filter.DomainParser');

    /**
     * We extend the basic FilterGroup to inherit the method to toggle the filter
     * action, the class constructor and the template to render.
     */
    let DynamicFilterGroup = search_inputs.FilterGroup.extend({
        template: 'DynamicSearchView.filters',
        name: '',
        element_class: '',
        /**
         * Class constructor
         * @param filters the array of filters defined inside this group
         * @param parent the parent element in the component dom
         * @param attributes specific group attributes
         */
        init: function (filters, parent, attributes) {
            this.name = attributes.parent_name;
            this.element_class = attributes.element_class;
            this._super.apply(this, arguments);
        },
        /**
         * Method called when the user click an a element and the system make the query to filter or remove
         * filter. If the filter clicked is dynamic we show his child filters.
         * @param e Object
         */
        toggle_filter: function (e) {
            e.preventDefault();
            e.stopPropagation();
            // if the filter clicked is dynamic we show/hide the child filters
            if ($(e.target).parent().hasClass('o_dynamic_filter_parent')) {
                this._toggle_dynamic_filter($(e.target).parent());
            } else {
                // keep the system normal case
                this.toggle(this.filters[Number($(e.target).parent().data('index'))]);
            }
        },
        /**
         * Show or hide the child filters of a dynamic filter
         * @param target Object jquery object that define the target dynamic filter to act.
         * @private
         */
        _toggle_dynamic_filter: function (target) {
            $('.' + target.data('class')).toggle();
            if (target.hasClass('o_dynamic_closed_menu')) {
                target.removeClass('o_dynamic_closed_menu').addClass('o_dynamic_open_menu');
            } else {
                target.removeClass('o_dynamic_open_menu').addClass('o_dynamic_closed_menu');
            }
        }
    });

    /**
     * We include and inherit some methods of the base system SearchView
     */
    SearchView.include({
        /**
         * Class constructor inherited
         * @param parent
         * @param dataset
         * @param fvg
         * @param options
         */
        init: function (parent, dataset, fvg, options) {
            this._super.apply(this, arguments);
            // class attributes initialized
            this.dynamicFilters = [];
            this.allFilters = [];
            this.domainParser = new DomainParser;
        },
        /**
         * In this method we register the promises that we want to wait for his end moment to continue the
         * filter flow. We wait for the rpc call of all dynamic filters found in the search view.
         * @returns {Deferred}
         */
        willStart: function () {
            let self = this,
                def;
            if (!this.options.disable_favorites) {
                def = this.loadFilters(this.dataset, this.action_id).then(function (filters) {
                    self.favorite_filters = filters;
                });
            }
            return $.when(this._super(), def, this.getDynamicFilters());
        },
        /**
         * This method is used to parse all the dom elements children inside the arch definition of the view.
         * We get the dynamic filters definition and get the values required by his configuration.
         * @returns {Promise}
         */
        getDynamicFilters: function () {
            let filters = this.parseChildrenTags(), // get a list with all arch element definitions
                self = this,
                def = $.Deferred(),
                requests = [];
            _.each(filters, function (filter) {
                // thanks to https://davidwalsh.name/merge-objects
                filter.item.attrs.attrs = {...filter.item.attrs.attrs, ...filter.item.attrs.modifiers};
                // If current filter is dynamic we get his configuration and make requests to server to get data
                // to populate child filters
                if ('filter' === filter.item.tag && self.isDynamicFilter(filter)) {
                    let model = filter.item.attrs.attrs.model || self.dataset._model.name || self.fields_view.model;
                    //we push the request for further execution
                    requests.push(
                        self._rpc(self.getRpcOptions(model, filter))
                    );
                    self.dynamicFilters.push(filter);
                } else {
                    self.allFilters.push(filter);
                }
            });
            // execute all promises requests to get filters child data
            $.when.apply(self, requests).done(function () {
                // this method is executed when all the rpc calls are made.
                let key;
                for (key in arguments) {
                    let filter = self.dynamicFilters[key],
                        data = arguments[key];
                    // for every record obtained from this dynamic filter configuration we create a new filter
                    // definition
                    _.each(data, function (element) {
                        let name = 'o_dynamic_filter_' + utils.slug(filter.item.attrs.name || filter.item.attrs.string || 'Parent Name ' + key, '_'),
                            item = {
                                attrs: {
                                    string: self.getChildFilterString(filter.item.attrs.attrs, element),
                                    name: name + '_' + element.id,
                                    modifiers: {},
                                    domain: self.domainParser.parse(filter.item.attrs.attrs.format_domain, element),
                                    type: 'dynamic',
                                    parent_name: filter.item.attrs.string || filter.item.attrs.name || 'Parent Name ' + key,
                                    element_class: name
                                },
                                tag: 'filter',
                                children: []
                            };
                        // queue the filter with the all regular filters
                        self.allFilters.push({
                            category: 'filters',
                            item: item
                        });
                    });
                }
                def.resolve();
            }).fail(function (error) {
                self.do_warn(_t("Error"), error.message, true);
            });
            return def.promise();
        },
        getRpcOptions: function (model, filter) {
            let result = {
                model: model,
                method: 'search_read',
                domain: filter.item.attrs.domain,
                context: filter.item.attrs.context
            };
            if (filter.item.attrs.attrs.limit) {
                result['limit'] = parseInt(filter.item.attrs.attrs.limit);
            }
            if (filter.item.attrs.attrs.offset) {
                result['offset'] = parseInt(filter.item.attrs.attrs.offset);
            }
            if (filter.item.attrs.attrs.fields) {
                if ('string' === typeof filter.item.attrs.attrs.fields) {
                    filter.item.attrs.attrs.fields = filter.item.attrs.attrs.fields.split(',');
                }
                result['fields'] = filter.item.attrs.attrs.fields;
            }
            if (filter.item.attrs.attrs.order_by) {
                result['orderBy'] = filter.item.attrs.attrs.order_by.trim();
            }
            return result;
        },
        /**
         * Generate the child filter display name based on if the user define a field to use as display name or
         * use the name or display name of the record element
         * @param attributes Object
         * @param element Object
         * @returns {string}
         */
        getChildFilterString: function (attributes, element) {
            if (attributes.name_field && attributes.name_field in element) {
                return element[attributes.name_field];
            }
            return element.name || element.display_name;
        },
        /**
         * We get the xml definition of the arch element of the search view and parse all the attributes
         * of every element
         * @returns {*[]}
         */
        parseChildrenTags: function () {
            let arch = this.fields_view.arch,
                self = this;

            function eval_item(item) {
                let category = 'filters';
                try {
                    item.attrs.context = self.parseDynamicFilterAttributes('context', item.attrs.context);
                    item.attrs.domain = self.parseDynamicFilterAttributes('domain', item.attrs.domain);
                    if (item.attrs.context.group_by) {
                        category = 'group_by';
                    }
                    item.attrs.attrs = self.parseDynamicFilterAttributes('context', item.attrs.attrs);
                } catch (e) {
                    // console.log(e);
                }
                return {
                    item: item,
                    category: category,
                };
            }

            return [].concat.apply([], _.map(arch.children, function (item) {
                return item.tag !== 'group' ? eval_item(item) : item.children.map(eval_item);
            }));
        },
        /**
         * This function act as a wire for the py_eval eval method
         * @param type string
         * @param attributes string
         * @returns {*}
         */
        parseDynamicFilterAttributes: function (type, attributes) {
            let available = ['context', 'contexts', 'domain', 'domains', 'groupbys'];
            if (!available.includes(type)) {
                throw new Error("Unknown evaluation type: " + type);
            }
            try {
                attributes = py_eval.eval(type, attributes);
            } catch (e) {
                // console.log([e, type, attributes]);
                switch (type) {
                    case 'context':
                    case 'contexts':
                    case 'groupbys':
                        return {};
                    case 'domain':
                    case 'domains':
                        return [];
                }
            }
            return attributes;
        },
        /**
         * Detect if a filter is dynamic or not
         * @param filter Object
         * @returns {boolean}
         */
        isDynamicFilter: function (filter) {
            if (filter.item.attrs.type && 'dynamic' === filter.item.attrs.type) {
                return true;
            }
            if (undefined === filter.item.attrs.attrs) {
                return false;
            }
            return undefined !== filter.item.attrs.attrs.type && 'dynamic' === filter.item.attrs.attrs.type;
        },
        // it should parse the arch field of the view, instantiate the corresponding
        // filters/fields, and put them in the correct variables:
        // * this.search_fields is a list of all the fields,
        // * this.filters: groups of filters
        // * this.group_by: group_bys
        prepare_search_inputs: function () {
            let self = this,
                current_group = [],
                current_category = 'filters',
                categories = {filters: this.filters, group_by: this.groupbys},
                previousName = undefined;

            _.each(self.allFilters.concat({category: 'filters', item: 'separator'}), function (filter) {
                if (filter.item.tag === 'filter' && filter.category === current_category) {
                    if (self.isDynamicFilter(filter)) {
                        if (undefined === previousName) {
                            previousName = filter.item.attrs.parent_name;
                        } else if (previousName !== filter.item.attrs.parent_name) {
                            previousName = filter.item.attrs.parent_name;
                            categories[current_category].push(new DynamicFilterGroup(current_group, self, current_group[0].attrs));
                            current_group = [];
                        }
                    }
                    return current_group.push(new search_inputs.Filter(filter.item, self));
                }
                if (current_group.length) {
                    let group;
                    if (current_group[0].attrs.type === 'dynamic') {
                        group = new DynamicFilterGroup(current_group, self, current_group[0].attrs);
                    } else {
                        group = new search_inputs.FilterGroup(current_group, self)
                    }
                    categories[current_category].push(group);
                    current_group = [];
                }
                if (filter.item.tag === 'field') {
                    let attrs = filter.item.attrs;
                    let field = self.fields_view.fields[attrs.name];

                    // M2O combined with selection widget is pointless and broken in search views,
                    // but has been used in the past for unsupported hacks -> ignore it
                    if (field.type === "many2one" && attrs.widget === "selection") {
                        attrs.widget = undefined;
                    }

                    let Obj = core.search_widgets_registry.getAny([attrs.widget, field.type]);
                    if (Obj) {
                        self.search_fields.push(new (Obj)(filter.item, field, self));
                    }
                }
                if (filter.item.tag === 'filter') {
                    current_group.push(new search_inputs.Filter(filter.item, self));
                }
                current_category = filter.category;
            });
        },
    });

    return {
        DynamicFilterGroup: DynamicFilterGroup
    }
});